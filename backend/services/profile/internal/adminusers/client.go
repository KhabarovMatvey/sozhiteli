// Package adminusers reads the account directory through the Keycloak Admin
// REST API. It never accesses credential, session or database endpoints.
package adminusers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	errUnavailable = errors.New("identity directory unavailable")
	errNotFound    = errors.New("identity directory entry not found")
)

// Config contains server-only credentials for a client with view-users rights.
type Config struct {
	BaseURL      string
	Realm        string
	ClientID     string
	ClientSecret string
}

// Validate rejects ambiguous URLs and path components before credentials are sent.
func (c Config) Validate() error {
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" ||
		u.RawPath != "" || strings.ContainsAny(c.BaseURL, "\r\n\t ") {
		return errors.New("KEYCLOAK_ADMIN_BASE_URL must be an absolute HTTP(S) URL without credentials, query or fragment")
	}
	if u.Path != "" && u.Path != "/" && u.Path != "/id" && u.Path != "/id/" {
		return errors.New("KEYCLOAK_ADMIN_BASE_URL path must be empty or /id")
	}
	if c.Realm == "" || strings.ContainsAny(c.Realm, "/\\?#% \r\n\t") || c.Realm == "." || c.Realm == ".." {
		return errors.New("KEYCLOAK_ADMIN_REALM must be a realm name")
	}
	if strings.TrimSpace(c.ClientID) == "" || strings.ContainsAny(c.ClientID, "\r\n\t") {
		return errors.New("KEYCLOAK_ADMIN_CLIENT_ID must be a client identifier")
	}
	return nil
}

// User is an explicit allowlist of directory fields. Upstream representations
// are decoded separately so added Keycloak fields cannot escape through this DTO.
type User struct {
	ID             uuid.UUID
	Username       string
	Email          string
	Enabled        bool
	EmailVerified  bool
	CreatedAt      *time.Time
	ServiceAccount bool
}

// Page is one provider page and its count under the identical search filter.
type Page struct {
	Users []User
	Total int64
}

// Client performs only token acquisition and the two allowed directory GETs.
type Client struct {
	config Config
	http   *http.Client
}

// New returns nil when directory access is deliberately unconfigured. Other
// admin features and ordinary product operations remain available in that case.
func New(config Config) (*Client, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if config.ClientSecret == "" {
		return nil, nil
	}
	return &Client{config: config, http: &http.Client{
		Timeout: 4 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}, nil
}

// List reads at most max accounts. The overall deadline covers all three
// requests, including token acquisition. Provider errors deliberately contain
// no response bodies, URLs, account information or credentials.
func (c *Client) List(ctx context.Context, first, max int, search string) (Page, error) {
	if c == nil || first < 0 || max < 1 || max > 50 {
		return Page{}, errUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	token, err := c.token(ctx)
	if err != nil {
		return Page{}, errUnavailable
	}
	filter := url.Values{}
	if search != "" {
		filter.Set("search", search)
	}
	endpoint := c.adminBase() + "/users"
	var total int64
	if err := c.get(ctx, endpoint+"/count?"+filter.Encode(), token, &total, 4096); err != nil || total < 0 {
		return Page{}, errUnavailable
	}
	filter.Set("first", strconv.Itoa(first))
	filter.Set("max", strconv.Itoa(max))
	filter.Set("briefRepresentation", "true")
	var rows []struct {
		ID                   string `json:"id"`
		Username             string `json:"username"`
		Email                string `json:"email"`
		Enabled              bool   `json:"enabled"`
		EmailVerified        bool   `json:"emailVerified"`
		CreatedTimestamp     *int64 `json:"createdTimestamp"`
		ServiceAccountClient string `json:"serviceAccountClientId"`
	}
	if err := c.get(ctx, endpoint+"?"+filter.Encode(), token, &rows, 1024*1024); err != nil || len(rows) > max {
		return Page{}, errUnavailable
	}
	users := make([]User, 0, len(rows))
	for _, row := range rows {
		id, err := uuid.Parse(row.ID)
		if err != nil {
			return Page{}, errUnavailable
		}
		var createdAt *time.Time
		if row.CreatedTimestamp != nil {
			stamp := time.UnixMilli(*row.CreatedTimestamp).UTC()
			if stamp.Year() < 1 || stamp.Year() > 9999 {
				return Page{}, errUnavailable
			}
			createdAt = &stamp
		}
		users = append(users, User{
			ID: id, Username: row.Username, Email: row.Email, Enabled: row.Enabled,
			EmailVerified: row.EmailVerified, CreatedAt: createdAt,
			ServiceAccount: row.ServiceAccountClient != "" || strings.HasPrefix(row.Username, "service-account-"),
		})
	}
	return Page{Users: users, Total: total}, nil
}

// Exists reports whether an account with this identifier exists. It reads one
// account with the same view-users right and returns no attributes from it.
func (c *Client) Exists(ctx context.Context, id uuid.UUID) (bool, error) {
	if c == nil {
		return false, errUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	token, err := c.token(ctx)
	if err != nil {
		return false, errUnavailable
	}
	var user struct {
		ID string `json:"id"`
	}
	err = c.get(ctx, c.adminBase()+"/users/"+id.String(), token, &user, 64*1024)
	switch {
	case errors.Is(err, errNotFound):
		return false, nil
	case err != nil:
		return false, errUnavailable
	}
	return user.ID == id.String(), nil
}

// token exchanges the server-only secret for a short-lived access token. The
// returned value is used once and never logged or returned to callers.
func (c *Client) token(ctx context.Context) (string, error) {
	form := url.Values{
		"grant_type": {"client_credentials"}, "client_id": {c.config.ClientID},
		"client_secret": {c.config.ClientSecret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.config.BaseURL, "/")+"/realms/"+url.PathEscape(c.config.Realm)+"/protocol/openid-connect/token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", errUnavailable
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := c.decode(req, &token, 128*1024); err != nil || token.AccessToken == "" {
		return "", errUnavailable
	}
	return token.AccessToken, nil
}

// adminBase is the Keycloak Admin REST root of the configured realm.
func (c *Client) adminBase() string {
	return strings.TrimRight(c.config.BaseURL, "/") + "/admin/realms/" + url.PathEscape(c.config.Realm)
}

func (c *Client) get(ctx context.Context, endpoint, token string, out any, limit int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return errUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return c.decode(req, out, limit)
}

func (c *Client) decode(req *http.Request, out any, limit int64) error {
	response, err := c.http.Do(req)
	if err != nil {
		return errUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusNotFound {
		return errNotFound
	}
	if response.StatusCode != http.StatusOK {
		return errUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(raw)) > limit || json.Unmarshal(raw, out) != nil {
		return errUnavailable
	}
	return nil
}

package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"sozhiteli.internal/platform/auth"
	"sozhiteli.internal/platform/problem"
	"sozhiteli.internal/profile/internal/profilerules"
	"sozhiteli.internal/profile/internal/questionnaire"
	"sozhiteli.internal/profile/internal/store"
)

// Server implements the public Profile API (StrictServerInterface, generated
// from contracts/openapi/profile.v1.yaml).
//
// How to implement an operation:
//  1. take the caller from auth.UserID(ctx) - never from the request;
//  2. return the generated success type (for example GetMyProfile200JSONResponse);
//  3. for every failure return a *problem.Error (problem.NotFound, problem.Validation, ...);
//     any other error becomes a logged 500;
//  4. set x-implementation-status: implemented in the contract and add a
//     contract test next to the existing ones.
type Server struct {
	queries *store.Queries
	now     func() time.Time
}

// NewServer returns the public API implementation.
func NewServer(queries *store.Queries) *Server {
	return &Server{queries: queries, now: time.Now}
}

var _ StrictServerInterface = (*Server)(nil)

// GetQuestionnaire returns the current questionnaire definition.
//
// This is the reference implementation of an operation without a database:
// follow its shape. GetMyProfile is the reference for one with a database.
func (s *Server) GetQuestionnaire(_ context.Context, _ GetQuestionnaireRequestObject) (GetQuestionnaireResponseObject, error) {
	def := questionnaire.Current()

	questions := make([]Question, 0, len(def.Questions))
	for _, q := range def.Questions {
		options := make([]QuestionOption, 0, len(q.Options))
		for _, o := range q.Options {
			options = append(options, QuestionOption{Code: o.Code, Label: o.Label})
		}
		questions = append(questions, Question{Code: q.Code, Title: q.Title, Options: options})
	}
	return GetQuestionnaire200JSONResponse{Version: def.Version, Questions: questions}, nil
}

// ListCities returns the cities where the search is available.
func (s *Server) ListCities(ctx context.Context, _ ListCitiesRequestObject) (ListCitiesResponseObject, error) {
	rows, err := s.queries.ListCities(ctx)
	if err != nil {
		return nil, fmt.Errorf("list cities: %w", err)
	}
	items := make([]City, 0, len(rows))
	for _, row := range rows {
		items = append(items, City{Id: int32(row.ID), Name: row.Name, Region: row.Region})
	}
	return ListCities200JSONResponse{Items: items}, nil
}

// GetMyProfile returns the profile of the caller.
func (s *Server) GetMyProfile(ctx context.Context, _ GetMyProfileRequestObject) (GetMyProfileResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := s.queries.GetProfile(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, problem.NotFound("profile_not_found", "profile has not been created yet")
	}
	if err != nil {
		return nil, fmt.Errorf("load profile: %w", err)
	}
	profile, err := profileFromRow(row)
	if err != nil {
		return nil, err
	}
	return GetMyProfile200JSONResponse(profile), nil
}

// PutMyProfile creates or fully replaces the profile of the caller.
// The change reaches the profile change feed through database triggers.
func (s *Server) PutMyProfile(ctx context.Context, request PutMyProfileRequestObject) (PutMyProfileResponseObject, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, problem.InvalidRequest("request body is required")
	}
	body := *request.Body

	in := profilerules.Normalize(rulesInput(body))
	fieldErrors := profilerules.Validate(in, s.now(), questionnaire.Current())

	cityKnown, err := s.cityExists(ctx, body.CityId)
	if err != nil {
		return nil, err
	}
	if !cityKnown {
		fieldErrors = append(fieldErrors, unknownCity())
	}
	if len(fieldErrors) > 0 {
		return nil, problem.Validation(fieldErrors...)
	}

	habits, err := json.Marshal(in.Habits)
	if err != nil {
		return nil, fmt.Errorf("encode habits: %w", err)
	}
	row, err := s.queries.UpsertProfile(ctx, store.UpsertProfileParams{
		UserID:               userID,
		DisplayName:          in.DisplayName,
		BirthYear:            int16(in.BirthYear),
		Gender:               string(body.Gender),
		Occupation:           in.Occupation,
		CityID:               int16(body.CityId),
		Districts:            in.Districts,
		BudgetMinRub:         in.BudgetMinRub,
		BudgetMaxRub:         in.BudgetMaxRub,
		MoveInFrom:           in.MoveInFrom,
		MoveInTo:             in.MoveInTo,
		RoommateGender:       string(body.RoommateGender),
		QuestionnaireVersion: in.QuestionnaireVersion,
		Habits:               habits,
		SearchStatus:         string(body.SearchStatus),
	})
	if isForeignKeyViolation(err) {
		// The city was removed between the check and the write.
		return nil, problem.Validation(unknownCity())
	}
	if err != nil {
		return nil, fmt.Errorf("save profile: %w", err)
	}
	profile, err := profileFromRow(row)
	if err != nil {
		return nil, err
	}
	return PutMyProfile200JSONResponse(profile), nil
}

func (s *Server) cityExists(ctx context.Context, id int32) (bool, error) {
	// City identifiers are smallint in the database: a value outside that
	// range cannot exist and must not overflow the conversion.
	if id < 1 || id > math.MaxInt16 {
		return false, nil
	}
	found, err := s.queries.CityExists(ctx, int16(id))
	if err != nil {
		return false, fmt.Errorf("check city: %w", err)
	}
	return found, nil
}

func unknownCity() problem.FieldError {
	return problem.FieldError{Field: "city_id", Code: profilerules.CodeUnknownCity, Message: "no such city"}
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

package api

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"sozhiteli.internal/interaction/internal/store"
)

// Database rows and API types are different types on purpose: a schema change
// must never silently change the API (docs/API_CONTRACTS.md).

// listedRequest is a row of either list query; both have the same shape.
type listedRequest struct {
	ID               uuid.UUID
	CounterpartID    uuid.UUID
	Status           string
	CreatedAt        time.Time
	RespondedAt      pgtype.Timestamptz
	CounterpartKind  pgtype.Text
	CounterpartValue pgtype.Text
}

func (r listedRequest) toAPI(direction Direction) ContactRequest {
	out := ContactRequest{
		Id:            r.ID,
		Direction:     direction,
		CounterpartId: r.CounterpartID,
		Status:        ContactRequestStatus(r.Status),
		CreatedAt:     r.CreatedAt,
		RespondedAt:   respondedAt(r.RespondedAt),
	}
	// The query joins the contact only for accepted requests; the status check
	// repeats the rule here so that a query mistake cannot reveal a contact.
	if out.Status == Accepted && r.CounterpartKind.Valid && r.CounterpartValue.Valid {
		out.CounterpartContact = &Contact{Kind: ContactKind(r.CounterpartKind.String), Value: r.CounterpartValue.String}
	}
	return out
}

func outgoingRequest(r store.ContactRequest) ContactRequest {
	return ContactRequest{
		Id:            r.ID,
		Direction:     Outgoing,
		CounterpartId: r.RecipientID,
		Status:        ContactRequestStatus(r.Status),
		CreatedAt:     r.CreatedAt,
		RespondedAt:   respondedAt(r.RespondedAt),
	}
}

func incomingRequest(r store.ContactRequest) ContactRequest {
	return ContactRequest{
		Id:            r.ID,
		Direction:     Incoming,
		CounterpartId: r.SenderID,
		Status:        ContactRequestStatus(r.Status),
		CreatedAt:     r.CreatedAt,
		RespondedAt:   respondedAt(r.RespondedAt),
	}
}

func respondedAt(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

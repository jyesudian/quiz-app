# Project: Quiz Application

## Overview

This is a web-based quiz platform with two primary roles:

1. User
2. Admin

Users can:
- Google oAuth
- Attempt quizzes
- View scores/history
- Track progress

Admins can:
- Create/manage quizzes
- Create/manage questions
- View analytics
- Manage users

Tech stack:
- Frontend: React + Vite
- Backend: Supabase
- Database: PostgreSQL (Supabase)
- Authentication: Supabase Auth with Google login
- Hosting: Vercel

---

# Architecture

## Frontend Structure

/src
/components
/pages
/hooks
/services
/context
/layouts
/utils
/types

## Backend

Supabase handles:
- Authentication
- PostgreSQL database
- Row Level Security (RLS)
- Storage
- Edge functions (optional)

---

# Authentication Rules

Authentication is mandatory for:
- Attempting quizzes
- Viewing results
- Admin operations

Use Supabase Auth.

Supported login:
- Google OAuth
- Email/password (optional)

Role management:
- Store role in `profiles` table
- Roles:
  - user
  - admin

Never trust frontend role checks alone.
Always enforce authorization in:
- Supabase RLS
- Backend APIs
- Edge functions

---

# Database Design

## Tables

### profiles
Stores user profile data.

- Refer the Database details in sql-schema

# Security Rules

- Enable RLS on all tables.
- Users can only view/update their own records.
- Only admins can:
  - create quizzes
  - modify questions
  - delete quizzes
- Never expose service role key in frontend.
- Use environment variables properly.

---

# Coding Standards

## React

- Use functional components.
- Prefer hooks over class components.
- Use TypeScript where possible.
- Keep components small and reusable.

## API Calls

- Centralize Supabase calls in `/services`.
- Avoid inline API logic in UI components.

## State Management

Preferred:
- Context API
- Zustand (optional)

Avoid unnecessary prop drilling.

---

# UI/UX Rules

- Responsive design mandatory.
- Mobile-friendly layout.
- Use loading indicators for async operations.
- Show meaningful error messages.

---

# Quiz Rules

- Questions can be:
  - single choice
  - multiple choice (future)
  - AI based fill in the blanks
- Timer auto-submits quiz.
- Prevent duplicate attempts if configured.
- Shuffle questions optionally.

---

# Admin Panel Rules

Admins can:
- CRUD quizzes
- CRUD questions
- View leaderboard
- View user attempts

Admin routes must be protected.

---

# Environment Variables

Required variables:

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

Never commit `.env` files.

---

# Git Workflow

Branches:
- main
- dev
- feature/*

Commit format:
feat:
fix:
refactor:
docs:

---

# Testing

Minimum expectations:
- Component testing
- Authentication testing
- Quiz submission validation
- RLS policy validation

---

# Deployment

Build command:
npm run build

Development:
npm run dev

---

# AI Assistant Instructions

When generating code:
- Preserve existing folder structure.
- Do not duplicate business logic.
- Reuse components where possible.
- Use async/await consistently.
- Add comments only where logic is non-obvious.
- Prefer modular architecture.
- Avoid hardcoding secrets.
- Validate all user input.

When modifying database:
- Provide migration-safe SQL.
- Include RLS policies.
- Avoid destructive schema changes.

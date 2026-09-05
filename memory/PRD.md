# PRD — Multi-Tenant Company Context ERP (MERIDIAN)

## Problem Statement
Implement a robust multi-tenant company context across all major forms and profiles, restricted by Super Admin privileges, with automatic session initialization upon login. Company selection dropdown visible ONLY for Super Admin (with on-the-fly switching); regular users are locked to their assigned company. 10 CRUD profiles must auto-attach company_id/company_name on submit.

## User Personas
- **Super Admin** — Full tenant-estate access. Can switch active company globally from sidebar; sees "All Companies" or a specific tenant. Can create/edit/delete companies, users (including super_admin role), and any profile in any company.
- **Standard User** — Locked to a single `company_id` at login. All lists, creates, updates, deletes are auto-scoped to their tenant. The company selector renders as a locked, read-only badge.

## Core Requirements
- JWT auth (localStorage, `Authorization: Bearer`), 7-day expiry
- Session-persisted `activeCompanyId` for super admin (localStorage)
- 10 CRUD profiles: Roles, Users, Departments, Routes, Brands, Products, Units, Items, Customers, Employees
- Each row carries `company_id` + `company_name`; server-side isolation
- Reusable `<CompanyDropdown>` in every form + `<SuperAdminSwitcher>` in sidebar
- Reusable `<CrudPage>` for 9 uniform profiles; dedicated `UsersPage` for password/role handling

## Architecture
- **Backend**: FastAPI + Motor (Mongo). `PROFILE_RESOURCES` dict + `make_profile_endpoints()` factory generates identical CRUD for 9 resources. `resolve_company_scope(user, requested)` centralizes tenancy.
- **Frontend**: React 19 + React Router 7, ShadCN UI. `AuthContext` + `CompanyContext` provide user/isSuperAdmin + activeCompany/scopeQuery. Sheet + Table + AlertDialog pattern for all CRUD.

## What's Been Implemented (2026-02)
- ✅ JWT auth (login/me) + bcrypt password hashing
- ✅ Seeded: 3 companies, 1 super admin (ja3442000045@gmail.com), 3 company users, 2 seed rows per profile per company
- ✅ Companies CRUD (super admin only)
- ✅ Users CRUD with role + company assignment guards
- ✅ 9 profile CRUD endpoints via factory (roles, departments, routes, brands, products, units, items, customers, employees)
- ✅ Dashboard summary with per-company counts
- ✅ Sidebar with Super Admin glass-morphism company switcher / locked badge for users
- ✅ Reusable CompanyDropdown component wired into every profile form
- ✅ Login split-screen page with architectural hero image
- ✅ 32/32 backend tests passing (auth, tenant isolation, CRUD, role guards)

## Prioritized Backlog

### P1 — Next up
- Companies management UI (currently backend-only)
- User profile page (change own password, view assigned company)
- Audit log per resource (who edited what, when)

### P2 — Nice-to-haves
- Dark mode toggle
- CSV export per profile
- Pagination for large lists
- Partial (PATCH) update endpoints
- Row-level permissions per role (currently only super_admin vs user)

## Test Credentials
See `/app/memory/test_credentials.md`

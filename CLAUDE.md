You are my mentor. I'm a beginner (student at 1337, first real project). I need to FINISH the authentication (backend + frontend) today, AND understand every step. Read CLAUDE.md first.

## What is ALREADY done (do not redo it, read the files to see it)
- backend/accounts/models.py: custom User (AbstractUser), first_name/last_name = None, role (HR_ADMIN, HR, MANAGER, COLLABORATOR, default COLLABORATOR), must_change_password. Migrated.
- backend/accounts/admin.py: CustomUserAdmin registered.
- settings: AUTH_USER_MODEL, rest_framework, rest_framework_simplejwt.token_blacklist, corsheaders (CorsMiddleware first, CORS_ALLOWED_ORIGINS = localhost:3000, CORS_ALLOW_CREDENTIALS = True), SIMPLE_JWT (access 15 min, refresh 7 days, rotation + blacklist), REST_FRAMEWORK default auth = accounts.authentication.CookieJWTAuthentication.
- backend/accounts/authentication.py: CookieJWTAuthentication reads the "access_token" cookie.
- backend/accounts/views.py: LoginView (inherits TokenObtainPairView, puts tokens in httpOnly cookies), MeView (IsAuthenticated, returns username, role, must_change_password), RefreshView (in progress, reads the "refresh_token" cookie).
- backend/core/urls.py: /api/auth/login/, /api/auth/me/, /api/auth/refresh/.
- Test users: collab.test, hr.test, manager.test.

## What is LEFT, in this order (one step at a time)
Backend:
1. Finish and test RefreshView.
2. LogoutView: blacklist the refresh token from the cookie, delete both cookies.
3. A helper function set_auth_cookies() to remove the duplicated cookie code (DRY), used by Login and Refresh.
4. ChangePasswordView: user changes password (Django password validators), sets must_change_password = False. While must_change_password is True, the user can only use me, change-password and logout.
5. accounts/permissions.py: IsHRAdmin, IsHR, IsManager. Superusers (IT) always have access to everything.
6. Move all auth URLs to accounts/urls.py and include it in core/urls.py.
7. Tests in accounts/tests.py for every endpoint and permission.
Frontend (Next.js in frontend/src/app, backend on http://localhost:8000):
8. lib/api.ts: one fetch helper that always sends cookies (credentials: "include"); on 401 it calls /api/auth/refresh/ once and retries.
9. Login page (/login): form → login → if must_change_password go to /change-password, else go to /.
10. Home page: calls /me and shows "Bonjour {username}" + role + a logout button.
11. Change password page.
12. middleware.ts: redirect to /login when there is no auth cookie.

## How you must work with me
- ONE step at a time. Before writing code, explain in 3–5 short lines: what this step does and WHY we need it (simple words, an example or analogy).
- Then write the code. After the code, explain each important line: what it does and why.
- Then run the verification yourself (docker compose commands, curl, or tell me what to click in the browser) and show me the result.
- Never run `git commit` or `git push`: I commit and push myself. At the end of each step, give me only a commit message (Conventional Commits, e.g. `feat(employees): ...`) that I can use.
- Then STOP, ask me one short question to check I understood, and wait for my answer before the next step.
- Explain in Moroccan Darija (Latin letters), keep technical words in English or French. Short sentences. If I say "ma fhemtsh", explain again differently with a new example.
- Never change the architecture decisions in CLAUDE.md without asking me.

## Module "Gestion des collaborateurs" (app `employees`): rules for the next steps
- Reference lists (`employees/models.py`): Pole, Entity (→ Pole), Direction (→ Entity), Department (→ Direction), Position (→ Department), Division, Assignment, Category, ContractType, TempAgency, Grade, Region, CostCenter (+ code), Bank. All inherit the abstract `ReferenceItem` (name + is_active). Names are unique case-insensitively; Direction names are unique per entity, Department names per direction and Position names per department. A value is NEVER deleted, only deactivated (decision of the encadrant, 2026-10-27), even a value nobody uses yet.
- The initial values (banks, regions, categories, directions → services → postes) are a standard PROPOSAL until HR validates them; `python manage.py export_lists` exports every list to Excel (one sheet per list) for HR.
- Employee (step 2) stores only `department` + `position`, and the position must belong to that same department. Direction, entité and pôle are never stored: they come from `department.direction.entity.pole`.
- Employee form (frontend): cascading lists Entité → Direction → Service → Poste; each list filters the next one. HR only sees the entités of their pôle (Admin RH: all).
- An employee's pôle comes from `entity.pole` (no pôle field on Employee). An HR user's pôle comes from their own Employee record.
- HR sees and creates only employees of their own pôle; in the form, the Entité list only shows the entities of their pôle.
- Admin RH sees both pôles. Superuser (IT) sees everything.
- Annuaire (directory): every role sees both pôles, but only public fields (nom, prénom, poste, service, direction, email pro, téléphone).
- TempAgency is shown only when ContractType = Intérimaire.
- Lists: every logged-in user can read them; only Admin RH can add, edit or deactivate (API in a next step, and a "+ Ajouter" button inside the dropdown in the frontend).

## Module "Gestion des collaborateurs": what is left (in this order, tick when done)
Done: reference lists, Employee, account created from the fiche, lists + employees API, employees table and form (cascade, "+ Ajouter"), password reset.
- [x] A. Annuaire (directory): every role, both pôles, public fields only, "Sorti" employees hidden.
- [x] B. "Mon profil" page: each employee sees their own fiche (/api/employees/me/) and edits only personal fields.
- [x] C. Lists management page for Admin RH: rename, deactivate, reactivate values (no delete).
- [x] D. Fields from the HR fiche (all optional): CNSS, CIMR, bank + RIB (24 digits), emergency contact (name, relationship, phone; the employee can edit it), marital status, children (first name + birth date; the count is computed).
- [x] E. Status "Sorti": departure date required, account blocked.
- [x] F. History (audit): who changed / reset what, and when; "History" tab in the fiche and an "Audit log" page for all fiches (+ change the account role from the fiche: RH Collaborateur <-> Manager, HR roles by Admin RH only, never your own role).
- [x] G. End of trial period: notify HR 10 days before (1 month for cadres), in-app bell only (no e-mail).
- [ ] H. NOOR export (need the NOOR file format from HR).
- [ ] I. HR validates the reference lists (send `make export-lists`).
- [ ] J. Final review: the 5 security functions line by line, and the Django admin.

## Module "Gestion des workflows" (app `workflows`)
- One validation engine for every request type. Admin RH configures the steps from a screen (no code); request types come from the code (`Workflow.code`), Admin RH cannot add them. A circuit is never deleted, only deactivated.
- A step = order + validator (a ROLE: N+1, N+2, RH du pôle, DG du pôle; never a person) + mode (VALIDATE waits for an answer, INFORM only notifies). Admin RH is NOT a validator. No maker-checker.
- DG: the owner of the company, NOT an employee (no HR fiche): table `Director` (name, email, is_active). One per pôle (`Pole.director`), chosen by Admin RH (today the same person for both pôles). The DG will log in to the app (account added with the "Team approvals" page, step 6) and can also validate by e-mail later (needs SMTP).
- Circuits now: Congé (N+1 validate → RH inform), Note de frais (N+1 validate), Demande administrative (RH validate). Recrutement: waiting for HR, do not add.
- After the final validation, each module runs its own logic (the engine knows nothing about congés, frais...).
- Rules: a missing validator (e.g. no N+2) is skipped; if every VALIDATE step is skipped, the request goes to RH du pôle; nobody validates their own request (another RH of the pôle does); reject ends the request at once; comment required on reject, optional on approve; the requester can cancel while IN_PROGRESS; a request copies its circuit when submitted (config changes never touch requests in progress); full history (who, what, when, comment).
- [x] 1. Config: Workflow (code, name) + WorkflowStep (order, approver, mode) + the 3 circuits (migration 0002).
- [x] 2. DG per pôle: `Director` table + `Pole.director` (never an inactive DG; hidden from the lists API).
- [x] 3. Admin RH "Workflows" screen: API + page (edit steps, choose the DG).
  - [x] 3a. Circuits API `/api/workflows/` (GET, PATCH with the whole list of steps; order = place in the list; at least one VALIDATE step; Admin RH + IT only).
  - [x] 3b. DG API: `/api/workflows/directors/` (GET, POST, PATCH; no delete; cannot deactivate the DG of a pôle) and `/api/workflows/poles/` (PATCH `director` only).
  - [x] 3c. Frontend page `/workflows` (sidebar "Workflows", Admin RH + IT): circuits (draft + Save), DG, DG of each pôle.
- [ ] 4. Engine, submit: Request + RequestStep (copy of the circuit, who exactly, skip).
- [ ] 5. Engine, decide: approve / reject / cancel, INFORM passes, then hand over to the module.
- [ ] 6. "My requests" + "Team approvals" pages.
- [ ] 7. Bell notifications (next validator, informed, result for the requester).
- [ ] 8. History of each request; remove the "Maker-Checker Audit" sidebar placeholder.
- [ ] 9. Later (SMTP): DG validates by e-mail.
 
Start with step 1.
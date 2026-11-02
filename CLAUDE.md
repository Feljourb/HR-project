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
- Employee form: the children list is shown only for Marié(e), Divorcé(e), Veuf(ve) (not Célibataire / empty); "End of trial period" only for status Période d'essai, "Departure date" only for Sorti. A hidden field is sent empty (null, or [] for children: existing children are removed, with a warning).
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

## Fiche fixes after the meeting (2026-10-31), BEFORE the "Congés" module (in this order)
- [x] K1. Phones (phone + emergency contact): Moroccan only, stored "+212" + 9 digits (first digit 5-8); the form shows a fixed "+212" and the user types 9 digits; old numbers converted by migration 0016 (invalid ones kept for HR to fix). Marital status is required (an old fiche without it does not block "Mon profil").
- [x] K2. Professional email generated automatically (`services.make_email`, migration 0017; HR can correct it when editing a fiche): first letter of the first name + "." + last name + the domain of the pôle (`Pole.email_domain`: SBD = silent-believers.com, Riaya = riaya-industries.com), e.g. f.alami@silent-believers.com; duplicate -> f.alami2. Only for NEW fiches: existing employees keep their real email (the mailbox already exists; IT creates the mailbox with the generated address).
- [x] K3. City = reference list `City` (ReferenceItem, ~100 main Moroccan cities, "+ Ajouter" for Admin RH, search while typing with a `<datalist>`); old text values converted by migration 0018 (an unknown text becomes a new city). "Mon profil" reads and writes the city by its name.
- K4. Automatic hierarchy (standard): a "responsable" (`head`) on Direction and on Service (= the team, e.g. Dev, Infra), chosen by Admin RH on the Lists page. N+1 = head of the service; if none (or it is the person) -> head of the direction; if it is the person -> DG of the pôle; the DG has nobody above. The hierarchy comes ONLY from the org chart: no manager chosen on the fiche (decision of the user, 2026-10-31: the "exception" field was removed, migration 0020 turned old managers of the same service into heads). The workflow engine uses this chain.
  - [x] K4a. Backend: `head` fields + rules (the head works in that service / direction, never "Sorti"; a head cannot leave their team), `Employee.n_plus_1` / `hierarchy()` (nothing stored; a "Sorti" head is skipped), API field `hierarchy`, engine uses `n_plus_1` (migrations 0019, 0020).
  - [x] K4c. A change of head goes to the history (action HEAD "Responsable d'équipe", one line in the fiche of the new AND the old head, so in the Audit log too; from the Lists page and from /admin; migration 0021). In the form, the N+x boxes are their own "Hierarchy" block, under "Organisation".
  - [x] K5. What IT (superuser, technical support) does is hidden from the history and the Audit log of HR and Admin RH (decision of the user, 2026-11-01): the lines are still recorded, visible in /admin and to every IT account (an IT sees what another IT changed). `EmployeeViewSet.visible_history`.
  - [x] K4b. Frontend: choose the head of each direction / service on the Lists page (Admin RH; the search only offers people of that service / direction: `?department=` / `?direction=` on /api/employees/; lists API sends `head_label`). In the employee form, read-only boxes N+1, N+2, N+3... filled live as soon as the department is chosen (`/api/employees/hierarchy-preview/?department=&employee=`); "Mon profil" shows the chain.

## Module "Gestion des congés" (app `leaves`)
Decisions (validated by the user 2026-11-02; standard + Moroccan Code du travail; values HR may still correct are settings, not code):
- A leave is a workflow request (`engine.submit("LEAVE")`, circuit N+1 validate -> RH inform); the leave module only adds types, day counting, balance and pages. After the final validation, `@on_approved("LEAVE")` confirms the leave.
- Counting: Monday–Friday = 1 day, Saturday = 0.5 day (nobody works on Saturday, but a leave counts it as half a day), Sunday = 0, public holidays = 0; half days possible (start in the afternoon / end at noon). E.g. Friday -> Monday = 1 + 0.5 + 0 + 1 = 2.5 days.
- Balance: 1.5 days acquired per month worked (18 / year), + 1.5 days per full 5 years of seniority, at most 36 days per year (company rule; the law says 30). `Employee.initial_leave_balance` = the balance when the app starts. Available = acquired − taken − pending. No negative balance. The balance carries over to the next year (no expiry in v1).
- Types (a list Admin RH manages): Congé annuel (taken from the balance), exceptional leaves with a legal maximum (mariage, naissance, décès... not taken from the balance), maladie and sans solde (not taken from the balance). Public holidays: a list Admin RH manages (fixed dates given; religious dates added each year when announced).
- Later (v2): supporting document upload (certificat médical), cancelling an already approved leave.
- [x] 1. Lists: `LeaveType` (deducted from the balance?, legal max days) + `PublicHoliday` (date, unique; the name repeats every year) with initial values (migration leaves 0002: 10 types, fixed holidays 2026–2027), in /admin.
- [x] 2. Day counting (`leaves/counting.py`: `count_days`, `day_values` = the detail day by day; weekdays 1, Saturday 0.5, Sunday 0, active holidays 0; `starts_afternoon` / `ends_noon` remove 0.5 only on a working day) + tests.
- [ ] 3. `LeaveRequest` + rules (dates, no overlap, enough balance, max days of the type) + submit through the engine.
- [ ] 4. Balance (acquired with months + seniority, cap 36, taken, pending, available) + leave settings.
- [ ] 5. `on_approved("LEAVE")` handler.
- [ ] 6. API (types, holidays, my leaves, preview of the day count + balance, create).
- [ ] 7. Collaborator pages: request form (live count + balance after) + "Mes congés".
- [ ] 8. HR: absences of the pôle; Admin RH manages leave types and holidays (Lists page).
- [ ] 9. Demo command + final tests.

## Module "Gestion des workflows" (app `workflows`)
- One validation engine for every request type. Admin RH configures the steps from a screen (no code); request types come from the code (`Workflow.code`), Admin RH cannot add them. A circuit is never deleted, only deactivated.
- A step = order + validator (a ROLE: N+1, N+2, RH du pôle, DG du pôle; never a person) + mode (VALIDATE waits for an answer, INFORM only notifies). "Admin RH" is not a separate choice in the circuits, but an Admin RH IS an RH of both pôles: "RH du pôle" steps are answered by the RH of the requester's pôle AND the Admin RH (decision 2026-10-30). One account per person (RBAC). No maker-checker.
- DG (decision of the encadrant, 2026-10-30, standard): the DG is an EMPLOYEE like the others (HR fiche + account with the role Manager), at the top of the org chart (the N+1 of the directors). One per pôle (`Pole.director` → Employee, never "Sorti"), chosen by Admin RH on /workflows (today the same person for both pôles). A "DG du pôle" step is answered by that employee (`RequestStep.assignee`), like an N+1. The former `Director` table is removed (migrations employees 0014/0015, workflows 0006).
- Circuits now: Congé (N+1 validate → RH inform), Note de frais (N+1 validate), Demande administrative (RH validate). Recrutement: waiting for HR, do not add.
- After the final validation, each module runs its own logic (the engine knows nothing about congés, frais...).
- Rules: a missing validator (e.g. no N+2) is skipped; if every VALIDATE step is skipped, the request goes to RH du pôle; nobody validates their own request (another RH of the pôle does); reject ends the request at once; comment required on reject, optional on approve; the requester can cancel while IN_PROGRESS; a request copies its circuit when submitted (config changes never touch requests in progress); full history (who, what, when, comment).
- [x] 1. Config: Workflow (code, name) + WorkflowStep (order, approver, mode) + the 3 circuits (migration 0002).
- [x] 2. DG per pôle: `Pole.director` → an Employee (never "Sorti"; hidden from the lists API).
- [x] 3. Admin RH "Workflows" screen: API + page (edit steps, choose the DG).
  - [x] 3a. Circuits API `/api/workflows/` (GET, PATCH with the whole list of steps; order = place in the list; at least one VALIDATE step; Admin RH + IT only).
  - [x] 3b. DG API: `/api/workflows/poles/` (PATCH `director` = an employee id, or null).
  - [x] 3c. Frontend page `/workflows` (sidebar "Workflows", Admin RH + IT): circuits (draft + Save), DG of each pôle (employee search).
- [x] 4. Engine, submit: Request + RequestStep (copy of the circuit, who exactly, skip) in `workflows/engine.py` (`submit`, `advance`). Requests are read-only in /admin.
  - [x] 4b. A pôle with no other RH than the requester: solved by `engine.hr_validators` (RH of the pôle + Admin RH, never the requester). The first version (`hr_admin_replaces`) was removed in migration 0005.
- [x] 5. Engine, decide: approve / reject / cancel (`can_decide`, row lock with `select_for_update`), INFORM passes, then hand over to the module (`@on_approved("LEAVE")` → `HANDLERS`). DG steps cannot be answered until the DG has an account (step 6).
- [ ] 6. "My requests" + "Team approvals" pages.
  - [x] 6a. API (all roles, each sees their own): `/api/workflows/requests/` (mine + `cancel`), `/api/workflows/approvals/` (steps waiting for me, `approve` / `reject` with `{"comment"}`; the id is the STEP id). Engine errors → 400/403 with the message.
  - [x] 6b. Pages `/requests` ("My Requests", every role) + `/approvals` ("Team Approvals") + `make seed-requests` (demo requests through `engine.submit`, after `make seed`; no module form yet) + `make send-request user=... type=LEAVE|EXPENSE|ADMIN_REQUEST title="..."` (one request from the terminal, prints the circuit and who gets the bell).
  - [x] 6c. DG account: not needed any more (the DG is an employee: account created with the fiche, role Manager).
- [x] 7. Bell notifications (next validator, informed, result for the requester): same bell and table as the trial period (`employees.Notification` + kinds TO_VALIDATE / INFORMED / APPROVED / REJECTED + `request`), sent by the engine (`workflows/notify.py`); unread "à valider" removed once answered or cancelled; `link` opens the right page.
- [x] 8. History of each request: page `/requests/<id>` (timeline), API `/api/workflows/history/<id>/` for the people concerned (requester, its validators, RH of the pôle, Admin RH, IT; others 404); bell links open it; "Maker-Checker Audit" placeholder removed.
- [ ] 9. Later (SMTP): DG validates by e-mail.
- [ ] 10. Final review before the soutenance: `submit`, `advance`, `can_decide`, `approve` / `reject` line by line (the user knows the big picture; details later).
 
Start with step 1.
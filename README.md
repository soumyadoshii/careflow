# Careflow Clinic ERP

Careflow is a clinic management application designed to simplify day-to-day healthcare operations through a unified interface for patient records, appointments, clinical workflows, and administrative tasks.

The application uses a React frontend and a TypeScript/Express backend, with SQLite for relational data storage. It includes authentication, API-driven workflows, reporting, and INR-based financial presentation.

## Features

- **Patient Management:** Maintain patient records and related information.
- **Appointment Management:** Organize appointments and clinic scheduling workflows.
- **Authentication and Access Control:** Secure API endpoints using JWT-based authentication.
- **Clinical Workflows:** Support connected clinic operations and patient-related workflows.
- **Reporting and Financial Data:** Provide reporting functionality and INR-based financial presentation.
- **Relational Database:** Store application data using SQLite with versioned migrations.
- **Demo Data:** Populate the local application with synthetic records for testing.

## Tech Stack

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite |
| Authentication | JWT |
| API | REST |
| Development Tools | npm, Git |

## Project Structure

```text
careflow/
├── api/                 # API-related project files
├── backend/
│   ├── data/            # Local SQLite database
│   ├── src/             # Backend source code
│   ├── .env.example     # Environment configuration template
│   └── package.json
├── frontend/
│   ├── src/             # Frontend source code
│   ├── package.json
│   └── vite.config.ts
├── .gitignore
├── README.md
├── FINAL_QA_REPORT.md
└── PHASE3_HANDOFF.md
```

## Prerequisites

Install the following before running the project:

- Node.js 22.5 or later
- npm
- Git

Check your installed versions:

```bash
node --version
npm --version
git --version
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/soumyadoshii/careflow.git
cd careflow
```

### 2. Configure and start the backend

Open a terminal in the project root and run:

```bash
cd backend
npm ci
```

Create your local environment file.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**macOS/Linux:**

```bash
cp .env.example .env
```

Open `backend/.env` and configure the following values:

```dotenv
JWT_SECRET=replace-with-a-private-random-secret-of-at-least-32-characters
PORT=4000
CLINIC_TIME_ZONE=Asia/Kolkata
CORS_ORIGIN=http://127.0.0.1:3000
DATABASE_PATH=./data/careflow.sqlite
```

Use a private, randomly generated JWT secret. Never commit `.env` or expose its contents publicly.

Initialize and verify the database:

```bash
npm run db:migrate
npm run db:seed
npm run db:verify
```

Start the backend:

```bash
npm run dev
```

The API should be available at:

`http://127.0.0.1:4000`

You can check its health endpoint at:

`http://127.0.0.1:4000/health`

Keep this terminal running.

### 3. Start the frontend

Open a second terminal from the project root:

```bash
cd frontend
npm ci
npm run dev
```

Open the application at:

**http://127.0.0.1:3000**

During local development, Vite proxies `/api` requests to the backend at `http://127.0.0.1:4000`.

Ensure the backend's `CORS_ORIGIN` matches the frontend origin.

## Demo Accounts

Synthetic demo accounts and their login details are documented in [`backend/DEMO_DATA.md`](backend/DEMO_DATA.md).

These accounts are intended for local development and testing only. Do not use demo credentials for a publicly accessible deployment. Configure secure credentials and appropriate access controls before exposing the application.

## Development and Testing

### Backend

Run these commands from the `backend/` directory:

```bash
npm run build
npm test
npm audit
```

### Frontend

Run these commands from the `frontend/` directory:

```bash
npm run typecheck
npm run build
npm audit
```

Use the migration and verification commands to manage and validate the local database.

**Warning:** `npm run db:reset` replaces the local database with synthetic seed data. Only use it when you intentionally want to reset your development database. Never point a reset operation at production data.

## Documentation

- [Phase 3 Handoff and Verification](PHASE3_HANDOFF.md)
- [Final QA and Security Report](FINAL_QA_REPORT.md)
- [Backend Setup Guide](backend/SETUP_GUIDE.md)
- [Database Contract](backend/DATABASE_CONTRACT.md)
- [Frontend API Contract](backend/FRONTEND_API_CONTRACT.md)
- [Synthetic Demo Data](backend/DEMO_DATA.md)

## Deployment Notes

The application is currently configured for local development.

The frontend can be hosted on a platform such as Vercel. The backend requires a compatible Node.js hosting environment, and the SQLite database requires persistent storage. A typical serverless deployment should use a managed database rather than rely on a local SQLite file.

Before deploying publicly:

- Configure environment variables securely on the hosting platform.
- Use a strong, private JWT secret.
- Replace demo credentials and review authentication and access controls.
- Configure the production frontend origin and backend API URL.
- Use a persistent production database and verify migrations.
- Run the build, type-checking, and test commands before release.

## License

Add a license to this repository if you intend to distribute or open-source the project.

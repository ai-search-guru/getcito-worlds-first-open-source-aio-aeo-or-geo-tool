# Contributing to Getcito

## Welcome

Thank you for your interest in contributing to Getcito! We welcome developers, designers, and enthusiasts to help us build a better open-source AEO and GEO platform. Whether you are fixing a bug, writing documentation, or proposing new features, your contributions are highly valued.

For minor fixes, feel free to open a pull request directly. For larger architectural changes or major features, please open an issue first so we can discuss the approach before you begin coding.

## Ways to Contribute

There are many ways you can contribute to the project, including but not limited to:
- **Bug reports**: Identify and report issues in our issue tracker.
- **Feature requests**: Propose new functionalities or enhancements.
- **Documentation improvements**: Fix typos, clarify guides, or write tutorials.
- **Code contributions**: Fix bugs or implement new features.
- **Performance improvements**: Optimize database queries, reduce bundle sizes, or speed up processing.
- **Security improvements**: Identify vulnerabilities and responsibly disclose them.
- **Tests**: Expand our unit (Vitest) and E2E (Playwright) test coverage.
- **Refactoring**: Clean up code and improve architecture.
- **Examples**: Build out use cases or provide sample configurations.
- **UI/UX improvements**: Improve dashboard accessibility, design, and usability.

## Development Setup

Getcito is a Turborepo monorepo using `pnpm` and Node.js 24. 

1. **Clone the repository**
   ```bash
   git clone https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool.git
   cd getcito-worlds-first-open-source-aio-aeo-or-geo-tool
   ```

2. **Configure environment**
   Create a `.env.local` file by copying the template. Fill in your necessary API keys and set `DEPLOYMENT_MODE=local`.
   ```bash
   cp .env.example .env.local
   cp .env.local .env
   cp apps/web/.env.local apps/web/.env
   ```

3. **Install dependencies**
   Ensure you have Node.js 24 installed. We recommend using `nvm`.
   ```bash
   nvm use 24
   corepack enable pnpm
   pnpm install
   ```

4. **Start the development server**
   Use Turborepo to start all development servers concurrently.
   ```bash
   pnpm dev
   ```

5. **Run tests**
   ```bash
   pnpm test       # Run unit tests
   pnpm test:e2e   # Run end-to-end tests
   ```

6. **Build the project**
   ```bash
   pnpm build
   ```

## Branch Naming Convention

Please use descriptive branch names based on the following prefixes:
- `feature/` - For new features
- `fix/` - For bug fixes
- `docs/` - For documentation updates
- `refactor/` - For code restructuring without behavior changes
- `test/` - For adding or updating tests
- `chore/` - For maintenance tasks, dependency updates, etc.
- `hotfix/` - For urgent production fixes

## Commit Message Convention

We strictly follow Conventional Commits for our commit messages. This helps us auto-generate changelogs and release notes.

**Examples:**
- `feat: add Google AI Mode scraping provider`
- `fix: resolve hydration error on prompt dashboard`
- `docs: update deployment prerequisites`
- `style: format trailing commas`
- `refactor: extract chart components to ui package`
- `perf: optimize postgres prompt querying`
- `test: add playwright cases for auth flow`
- `build: update dockerfile node version`
- `ci: migrate to new GitHub action runner`
- `chore: bump dependencies in workspace`

## Pull Request Process

1. **Fork the repository** to your own GitHub account.
2. **Create a branch** using our branch naming conventions.
3. **Keep commits clean** and logical using Conventional Commits.
4. **Run linting and formatting** locally using Biome:
   ```bash
   pnpm lint
   pnpm format
   ```
5. **Run tests** (`pnpm test`) to ensure you haven't broken existing functionality.
6. **Update documentation** if your changes impact the setup, CLI, or UI.
7. **Submit a Pull Request** against the `main` branch. 
   *(Note: For your first PR, sign the CLA by adding your username to `.github/contributors.txt`)*
8. **Address review comments** promptly and push updates to the same branch.

## Coding Standards

- **Formatting & Linting**: We use [Biome](https://biomejs.dev/). Do not use Prettier or ESLint. Run `pnpm format` before committing.
- **Naming Conventions**: Use `camelCase` for variables and functions, `PascalCase` for React components and Types/Interfaces, and `kebab-case` for file names.
- **Folder Structure**: Follow the Turborepo standard. UI components go in `packages/ui`, database logic in `packages/lib`, and route pages in `apps/web/src/routes`.
- **Testing Expectations**: New features must include Vitest unit tests. Critical UI paths must be covered by Playwright E2E tests.
- **Documentation Expectations**: If you introduce a new environment variable, it must be added to `packages/config/src/env-registry.ts` and documented in the `README.md`.

## Reporting Issues

When reporting an issue, please include:
- A clear, descriptive title.
- Steps to reproduce the bug.
- Expected vs. actual behavior.
- Context (OS, Browser, Node.js version, deployment mode).
- Screenshots or logs if applicable.

## Code Review Expectations

- **Review Process**: PRs will be reviewed by at least one core maintainer. We aim to review PRs within a few business days.
- **Required Approvals**: 1 maintainer approval is required before merging. All CI checks (lint, test, typecheck) must pass.
- **Quality Expectations**: Code must be typed (no `any`), well-documented, formatted, and strictly scoped to the PR's stated objective.

## Community Guidelines

We expect all contributors to maintain a respectful, inclusive, and collaborative environment. Be kind, provide constructive feedback, and assume positive intent. By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Project Maintainers

This project is actively maintained by:

### AI Search Guru

GitHub:
https://github.com/ai-search-guru

### Sachiiinnn

GitHub:
https://github.com/sachiiinnn

They are the primary maintainers responsible for:
- Reviewing pull requests
- Managing releases
- Maintaining project quality
- Reviewing architectural decisions
- Maintaining documentation
- Guiding the project roadmap

# Security Policy

## Supported Versions

We apply security fixes only to the **latest released version** of Getcito. If you are running an older version, please upgrade before reporting an issue.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

We take the security of Getcito seriously. If you discover a vulnerability, we ask that you report it to us confidentially so we can investigate and patch it before it is exploited.

Email [team@getcito.com](mailto:team@getcito.com) with:
- A description of the issue and its potential impact.
- Detailed steps to reproduce (proof-of-concept code or scripts are highly appreciated).
- The version, branch, or commit hash you tested against.
- Your name or handle if you would like to be credited in the responsible disclosure.

Please adhere to responsible disclosure expectations and give us a reasonable amount of time to investigate, resolve, and release a fix before publishing any details publicly.

## Response Timeline

- **Initial acknowledgement**: Within 48 hours of receiving your report.
- **Investigation**: We aim to confirm the vulnerability and assess its severity within 7 days.
- **Resolution**: A patch will be prioritized and released as soon as possible, depending on the complexity of the fix. We will keep you updated on our progress.

## Security Best Practices

When contributing to or deploying Getcito, please follow these security best practices:
- **Secrets**: Never commit API keys, Auth0 secrets, database passwords, or `.env` files to version control. Use `.env.local` for local overrides.
- **Environment Variables**: Always validate environment variables at startup. Use `packages/config/src/env-registry.ts` to enforce required variables securely.
- **Dependencies**: Keep dependencies up to date. Avoid installing unverified third-party npm packages.
- **Authentication**: All API endpoints under `/api/v1` must strictly enforce Bearer token authentication. 
- **Docker Security**: Our Docker containers run as a non-root user (`getcito` or `worker`). Do not alter the Dockerfile to run processes as root. Keep your host machine's Docker daemon secure.

## Contact

For all security-related inquiries, please contact:
**Email**: [team@getcito.com](mailto:team@getcito.com)

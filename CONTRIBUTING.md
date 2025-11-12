# Contributing Guidelines

Thank you for contributing to this project! Please follow these guidelines to maintain consistency across the codebase.

## Git Conventions

### Branch Naming

Branches should follow this naming convention:
```
<type>/<short-description>
```

**Rules:**
- Use **hyphens** to separate words in the description (not underscores)
- Keep descriptions short and descriptive
- Use lowercase letters

#### Branch Types

| Type | Purpose |
|------|---------|
| `feat` | New feature implementation |
| `fix` | Bug fixes |
| `chore` | Maintenance tasks, dependency updates |
| `refactor` | Code restructuring without changing functionality |
| `docs` | Documentation updates |
| `test` | Adding or updating tests |
| `style` | Code formatting, missing semicolons, etc. |
| `perf` | Performance improvements |
| `build` | Build system or external dependency changes |
| `ci` | CI/CD pipeline changes |
| `revert` | Reverting previous commits |
| `hotfix` | Critical fixes for production |

#### Examples
```
feat/add-user-profile
fix/login-error
chore/update-dependencies
refactor/auth-service
docs/update-readme
test/add-api-tests
```

### Commit Messages

Follow the conventional commit format:
```
<type>: short summary
```

#### Guidelines

- Use **imperative tone** (e.g., "add" not "added")
- Keep the summary short and descriptive
- First letter lowercase after the type
- No period at the end

#### Examples
```
feat: add user profile page
fix: handle invalid token error
refactor: optimize data fetching
perf: improve image loading speed
docs: update contribution guide
test: add missing unit tests
ci: update build pipeline
style: fix code formatting
chore: update dependencies to latest versions
```

### Pull Requests

#### PR Title

Use the same format as commit messages:
```
<type>: short summary
```


#### PR Description

List your changes as clear bullet points:
```markdown
- Added user profile form and API integration
- Updated validation for age and email
- Fixed UI alignment in profile section
```

**Guidelines:**
- Focus on **what** changed and **why** it matters
- Keep points concise and actionable
- Use past tense for completed work
- Mention any breaking changes
- Reference related issues if applicable

#### Example PR

**Title:**
```
feat: add user authentication system
```

**Description:**
```markdown
- Implemented JWT-based authentication
- Added login and registration endpoints
- Created middleware for protected routes
- Updated user model with password hashing
- Added authentication tests

Closes #123
```

## Getting Started

1. Fork the repository
2. Create a new branch following the naming convention
3. Make your changes
4. Write clear commit messages
5. Push your branch and create a pull request
6. Wait for review and address any feedback

## Code Review Process

- All PRs require at least one approval
- Address review comments promptly
- Keep PRs focused and reasonably sized
- Ensure all tests pass before requesting review

Thank you for your contributions!
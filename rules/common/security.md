# Security Guidelines

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Secret Management

- NEVER hardcode secrets in source code
- ALWAYS use environment variables or a secret manager
- Validate that required secrets are present at startup
- Rotate any secrets that may have been exposed

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues

## Bash Security (PaCode Specific)

When implementing Bash tool execution:
- Use AST parsing to analyze commands before execution
- Implement Parser Differential Defense - compare AST analysis with actual execution
- Never execute user-provided shell commands directly without validation
- Implement sandboxing for dangerous operations

## Permission System Requirements

- Implement deny-first permission model
- 7-layer permission pipeline must be enforced
- Never bypass permission checks for convenience
- Log all permission denials for audit

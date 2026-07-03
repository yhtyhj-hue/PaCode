# Rules Directory

This directory contains PaCode's rule files that define development standards and guidelines.

## Structure

```
rules/
├── README.md          # This file
└── common/           # Language-agnostic rules
    ├── agents.md      # Agent orchestration patterns
    ├── coding-style.md # Code style and conventions
    ├── security.md    # Security guidelines
    ├── testing.md     # Testing requirements
    ├── git-workflow.md # Git workflow
    ├── hooks.md       # Hooks system
    ├── patterns.md     # Common patterns
    ├── performance.md # Performance optimization
    └── code-review.md # Code review standards
```

## Integration

These rules are integrated from:
- [everything-claude-code](https://github.com/anthropics/claude-code) - Claude Code plugin ecosystem
- Claude Code development standards

## Usage

These rules should be followed when:
- Writing code for PaCode
- Reviewing code changes
- Implementing new features
- Creating tests

## Rule Priority

1. **Security rules** - Always apply, non-negotiable
2. **Testing rules** - Required for all features
3. **Coding style** - Consistency guidelines
4. **Agent patterns** - Recommended practices

## Customization

PaCode-specific rules are marked with "(PaCode Specific)" in their content.
These adapt the general guidelines to the PaCode architecture.

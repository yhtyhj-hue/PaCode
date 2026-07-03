# Common Patterns

## Skeleton Projects

When implementing new functionality:
1. Search for battle-tested skeleton projects
2. Use parallel agents to evaluate options:
   - Security assessment
   - Extensibility analysis
   - Relevance scoring
   - Implementation planning
3. Clone best match as foundation
4. Iterate within proven structure

## Design Patterns

### Repository Pattern

Encapsulate data access behind a consistent interface:
- Define standard operations: findAll, findById, create, update, delete
- Concrete implementations handle storage details (database, API, file, etc.)
- Business logic depends on the abstract interface, not the storage mechanism
- Enables easy swapping of data sources and simplifies testing with mocks

### API Response Format

Use a consistent envelope for all API responses:
- Include a success/status indicator
- Include the data payload (nullable on error)
- Include an error message field (nullable on success)
- Include metadata for paginated responses (total, page, limit)

## Context Assembly (PaCode Specific)

Claude Code assembles context from 9 ordered sources:

1. System Prompt
2. CLAUDE.md
3. Rules Layer
4. Skills
5. Working Memory
6. Task Context
7. MCP Tools
8. Project Context
9. Recent Results

## Tool Concurrency (PaCode Specific)

Tools declare `concurrencySafe`:
- `true`: Can run in parallel with other safe tools
- `false`: Must run serially

Batch execution groups tools by concurrency safety.

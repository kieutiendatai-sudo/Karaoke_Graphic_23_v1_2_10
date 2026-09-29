# Reference repositories

## Adobe Premiere CEP reference

https://github.com/Adobe-CEP/Samples/tree/master/PProPanel

Use this as the primary reference for:
- Premiere Pro CEP architecture
- ExtendScript integration
- Premiere Pro DOM/API usage
- Premiere Pro 23 API definitions

Important:
The project must remain compatible with Premiere Pro 23.
Do not migrate this project to UXP.

## Premiere Pro MCP reference

https://github.com/antipaster/Adobe-Premiere-Pro-MCP

Use only as an architecture/performance reference for:
- reducing CEP/ExtendScript round trips
- batching Premiere commands
- separating panel-side computation from host-side operations
- minimizing repeated Premiere DOM access

Do not copy the MCP architecture unless it directly improves this project.

## Rules for external references

- Do not replace working project code only because another repo does it differently.
- Do not copy large sections of code without checking compatibility.
- Prefer concepts and architecture patterns over direct copying.
- Premiere Pro 23 compatibility has priority.
- Existing visible karaoke output must remain unchanged.
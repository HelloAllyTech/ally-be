# Prompts

Prompt template files (`.txt`) synced to the database on startup.

## Naming Standards

**File and path names must be descriptive.** They drive the prompt's display name and description in the Dashboard. Generic names (e.g. `system`, `text`, `user`) produce confusing labels.

### Rules

| Rule | Example | Avoid |
|------|---------|-------|
| Use `snake_case` | `code_mixed_system.txt` | `system.txt` |
| Filename must describe purpose | `general_text_translation.txt` | `text.txt` |
| Minimum: subdir + descriptive filename | `openai_translation/speech_reexpression_user.txt` | `openai_translation/user.txt` |
| Combine generic terms with context | `translation_system_prompt.txt` | `system.txt` |

### Why

- The path `subdir/filename` becomes `promptCode` = `subdir_filename` (e.g. `openai_translation_code_mixed_system`)
- Display names are derived from `promptCode` via `formatLabel`
- Generic filenames like `system`, `text`, `user` yield unclear names in the UI

### Structure

```
src/prompts/
├── openai_simulation/
│   ├── character_profile_text.txt
│   ├── challenge_description.txt
│   └── ...
└── openai_translation/
    ├── code_mixed_system.txt
    ├── speech_reexpression_user.txt
    ├── general_text_translation.txt
    ├── guardrail_translation.txt
    └── ...
```

### Adding a New Prompt

1. Create a `.txt` file under the right subdir with a **descriptive** name
2. Restart the app — `PromptsSyncService` will sync on startup (name/description derived from path)
3. In code, use `toPromptCode(subdir, filename)` when fetching the prompt:
   ```ts
   import { toPromptCode } from 'src/prompt/util/prompt-code.util';
   const prompt = await promptSharedService.getPromptByCode(
     toPromptCode('openai_simulation', 'my_new_prompt'),
   );
   ```

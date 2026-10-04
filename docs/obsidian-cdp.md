# Driving the running Obsidian app over CDP

`scripts/obsidian-cdp.mjs` talks to the Obsidian renderer through the Chrome DevTools Protocol. It exists
because an Obsidian plugin cannot be verified from the outside: the panel either renders or it does not, and
only the app knows.

## Launch the app with a debug port

Obsidian only opens the port when it is started with the flag, and the port **must stay on loopback**. Never
bind it to a LAN address: an open CDP port is unauthenticated control of everything in the app.

```
osascript -e 'quit app "Obsidian"' && sleep 4 && open -a Obsidian --args --remote-debugging-port=9333
```

Confirm it answered, then close it when the work is done by relaunching without the flag:

```
curl -s --max-time 5 http://127.0.0.1:9333/json/version
osascript -e 'quit app "Obsidian"' && sleep 4 && open -a Obsidian
```

## Use it

```
node scripts/obsidian-cdp.mjs targets
node scripts/obsidian-cdp.mjs eval "<javascript expression>"
node scripts/obsidian-cdp.mjs screenshot /tmp/panel.png
```

`eval` runs in the app's renderer with `awaitPromise`, so an async IIFE works and its resolved value is
printed as JSON. Useful handles inside the app:

- `app.plugins.enabledPlugins` and `app.plugins.plugins` (loaded instances)
- `app.plugins.plugins['agent-dispatch'].runs.list()` (every run this session, with status and answer)
- `app.commands.executeCommandById('agent-dispatch:open-panel')`
- `app.plugins.disablePlugin(id)` then `enablePlugin(id)` reloads the plugin after a rebuild, which is faster
  than toggling it in settings

## What this caught that nothing else would

- The plugin loaded but its heartbeat file went nowhere: `vault.configDir` is relative, and the renderer's
  cwd is `/`. The resolved path had to come from `FileSystemAdapter.getBasePath()`.
- Four live runs in one eval showed codex and opencode sitting at "Reading additional input from stdin...",
  which is how the `stdio: ['ignore', 'pipe', 'pipe']` requirement was found.
- The panel screenshot is the only proof that a card renders the way the code intends.

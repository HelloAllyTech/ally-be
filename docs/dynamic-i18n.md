# Dynamic i18n Publishing

Runtime translations are edited through the admin API, stored as JSON files, and published as immutable static versions under `I18N_ROOT_DIR`.

## Backend Env

```sh
I18N_ROOT_DIR=/var/www/i18n
I18N_SOURCE_DIR=/app/seed/i18n/locales
I18N_VERSION_RETENTION=5
```

`I18N_SOURCE_DIR` should contain the bundled locale files for first-time seeding, for example `en.json`, `hi.json`, `mr.json`, `ta.json`, and `kn.json`. After the first draft exists, edits are read from `${I18N_ROOT_DIR}/drafts`.

## Static Layout

```text
/var/www/i18n/
├── manifest.json
├── .drafts/
│   └── en.json
├── v42/
│   ├── en/common.json
│   └── en/nav.json
└── v41/
```

The frontend reads `/i18n/manifest.json`, then fetches `/i18n/v<N>/<language>/<namespace>.json`.

## Caddy

```caddyfile
handle_path /i18n/* {
	root * /var/www/i18n
	encode zstd gzip

	header {
		Access-Control-Allow-Origin "https://app.example.com"
		Access-Control-Allow-Methods "GET, OPTIONS"
		Access-Control-Allow-Headers "Content-Type"
		Vary "Origin"
	}

	@options method OPTIONS
	respond @options 204

	@private path /.drafts/*
	respond @private 404

	@manifest path /manifest.json
	header @manifest Cache-Control "public, max-age=30, must-revalidate"

	@versioned path_regexp versioned ^/v[0-9]+/.+
	header @versioned Cache-Control "public, max-age=31536000, immutable"

	file_server
}
```

Set the helpline app env to the public static base URL when it is not same-origin:

```sh
VITE_I18N_BASE_URL=https://static.example.com/i18n
```

Publishing writes a full `v<N>` directory first, then atomically replaces `manifest.json`, so readers never observe a partially published version. Rollback only switches the manifest to a retained version.

## Placeholder contract

A value may carry `{{variable}}` placeholders, which i18next substitutes from the
options the calling code passes to `t()`. The **source language (`en`) owns that
contract**: whatever variables the code interpolates show up in English first,
and every translation of a key must carry the same set.

- Editing `en` is never blocked. Introducing or retiring a placeholder is a code
  decision, and English is where that decision lands.
- Editing any other language is rejected with `Placeholder mismatch` unless its
  placeholders match the **current English draft**.

So the order matters: update English first, then each translation. The admin
console names the languages left behind after an English edit ("Also update:
Hindi, Kannada"), because they will keep serving the old variable until they are
updated too.

This rule used to compare each value against *its own previous value*, which made
a placeholder impossible to remove by any route once published — the dashboard
rejected the edit, and `ciSync` only adds keys. Copy that dropped a variable the
code had stopped passing could never reach production, and users saw the raw
`{{max}}` on screen.

## Repo locales vs. published values

`POST /v1/i18n/ci-sync` copies **only keys the draft has never seen**. It does not
update a key that already exists, on purpose: the dashboard is where copy is
edited, and a CI run must not silently overwrite a human's wording.

The consequence is easy to get wrong: once a key has been published, **editing it
in the repo locale files changes nothing in production**. The published bundle is
layered over the shipped one at runtime (`addResourceBundle(..., deep, overwrite)`),
so the published value wins. The repo file only still governs first paint, before
the dynamic bundle loads.

To push a repo value for an existing key into the drafts without retyping it:

```sh
scripts/i18n-push-key.sh --key postSim.debrief.replyPlaceholder          # dry run
scripts/i18n-push-key.sh --key postSim.debrief.replyPlaceholder --apply --publish
```

It lives in the `ally-code` workspace, reads every language straight out of
`ally-web/apps/ally-helpline-dashboard/src/i18n/locales`, sends English first to
satisfy the placeholder contract, and prints the codepoints of anything invisible
(`…` U+2026, the ZWJ inside Marathi `अ‍ॅ`) before it sends.

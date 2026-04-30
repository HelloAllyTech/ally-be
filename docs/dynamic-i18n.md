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

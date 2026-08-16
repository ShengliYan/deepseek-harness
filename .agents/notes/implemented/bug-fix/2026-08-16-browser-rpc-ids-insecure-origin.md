# Agent Note: Browser RPC ids on insecure origins

Status: implemented

English | [中文](2026-08-16-browser-rpc-ids-insecure-origin.zh.md)

## Problem

The browser carrier mints every rpcId through `AbstractApiClient.mintRpcId`, which called `crypto.randomUUID()` directly. `crypto.randomUUID` exists only on secure origins (HTTPS or localhost). A browser that opens the Web GUI over plain HTTP on a LAN or Tailnet address runs on an insecure origin, where the property is `undefined`: every RPC throws at mint time, so the sidebar renders no workspaces, no sessions load, and creating a workspace surfaces `crypto.randomUUID is not a function`. The loopback origin (`http://127.0.0.1:<port>`) that the desktop shell loads is a secure context, which is why the same server appeared broken only from remote devices.

`dsh-client-connection` already carried a local `randomUuid()` built on `crypto.getRandomValues` - which insecure origins do expose - for its own generic-channel caller, so the transport had two id minters and only the non-shared one was secure-context-free. `dsh-client-ui-conversation`'s browser draft-attachment id used bare `crypto.randomUUID()` too and failed the same way on image intake.

## Decision

The shared helper moved to the transport package both browser surfaces already depend on: `@deepseek-ai/dsh-host-apiproxy/random-uuid` assembles an RFC 4122 version 4 UUID from `crypto.getRandomValues`, forcing the version and variant bits on the DataView before hex encoding. `mintRpcId` uses it, so every carrier (browser, in-process, and any future subclass) mints identically without a secure-context requirement. `dsh-client-connection`'s two callers import the export and the local copy is gone. `dsh-client-ui-conversation` declares the `dsh-host-apiproxy` dependency (package.json plus tsconfig reference; a library value import, not a plugin-to-plugin one) and mints draft-attachment ids through it.

## Alternatives considered

**Serve the GUI over HTTPS.** Deferred: the webserver binds plain HTTP by design and remote access over SSH tunnels or Tailscale addresses is a supported deployment; requiring TLS would also break the loopback desktop shell's same-origin assumptions. Secure-context-free minting keeps every supported origin working.

**Polyfill `crypto.randomUUID` in the shell.** Rejected: mutating the platform global from application code hides the requirement instead of removing it, and a partial polyfill would still leave direct call sites scattered.

**Keep a second copy in `ui-conversation`.** Rejected: cross-file clone detection gates the repository, and two implementations of one wire-correlation primitive is the duplication the shared export exists to prevent.

## Consequences

Every browser origin the fence admits - loopback, trusted-host, and LAN/Tailnet IP literals over plain HTTP - can mint rpcIds and draft-attachment ids. Host-side `crypto.randomUUID` callers (LLM message ids, anonymous identity, command instance tokens) are unaffected: Node's `crypto.randomUUID` has no secure-context restriction. Unit coverage stubs an origin whose `crypto` object carries only `getRandomValues` and asserts both `randomUuid()` and `mintRpcId()` produce version-4 ids there, plus distinctness across calls under the ambient crypto.

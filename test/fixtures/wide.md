# Wide content

Prose stays where you are reading it. Only the block below moves when you scroll
sideways, so you never lose the sentence explaining the command.

```bash
docker run --rm -it -v "$PWD:/work" -w /work --env FOO=bar --env BAZ=qux ghcr.io/example/some-image:v1.2.3 sh -lc 'echo hello from a very long command line'
short
```

| release | published | notes |
|---|---|---|
| 0.1.0 | 2026-08-13 | First cut: layout engine, viewport, search and contents |
| 0.2.0 | 2026-08-20 | Horizontal scrolling, link following, resume, clipboard |

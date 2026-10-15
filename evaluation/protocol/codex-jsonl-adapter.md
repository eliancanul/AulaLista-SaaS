# Adaptador Codex JSONL provisional y offline

Normaliza bytes locales; nunca lanza Codex ni un modelo. Está separado del
agregador de recibos sintéticos y de cualquier evaluación semántica.

## Entrada y evidencia

`normalize_jsonl(raw, invocation, semantics=None)` recibe el stream íntegro en bytes
y comprueba `invocation.raw_sha256`. `run_id`, `attempt_id`, `model_requested` y
`cli_version` son metadatos declarados de lanzamiento, no prueba del proveedor.
`reasoning_effort_requested`, `exit_code` y `wall_latency_ms` son opcionales y
conservan esa procedencia. Un exit no cero no reescribe un terminal nativo success.

Las pruebas incluyen streams sintéticos y un stream completo saneado, cuya
estructura fue cotejada con un original fuera del repositorio. El stream sustituye
identidades y contenido; el fragmento terminal de usage contiene sólo contadores.
No se publica el original ni su identidad. Una observación no certifica otros
builds, todos los intentos, identidad efectiva, fórmula de total o facturación.

`semantics` permite declaraciones explícitas de subconjunto con evidencia.
Por defecto, cached⊆input y reasoning⊆output son desconocidas. No se importa
semántica de otro API/build ni se infiere una fórmula de total.

## Garantías y límites

- Rechaza JSON duplicado/no finito, tokens negativos/bool/float/string, usage nuevo
  no revisado, terminales duplicados, turnos solapados y usage fuera del terminal.
- Conserva `thread_id` y `turn_id` cuando existe. `ordinal` y `event_line` son
  localizadores locales, nunca IDs oficiales de request/turn.
- `model_effective` y `provider_request_id` permanecen null aunque el llamador
  declare un modelo. Requested model no acredita identidad efectiva.
- `normalize_attempts` rechaza identidad run/attempt repetida, mismo bruto o thread
  reutilizado. Resume requiere un contrato separado. Valores de usage iguales en
  turnos distintos no son un criterio de deduplicación.
- Conserva por turno input, cached input, cache-write input, output, reasoning y
  total si existen. Campos ausentes son null; no hay suma global ni total derivado.
- Fallos conservan usage conocido; turnos abiertos quedan incompletos, no cero.
  JSON truncado y terminal huérfano rechazan normalización.
- Un error-item conserva una advertencia y su línea. El recorte de contexto marca
  `context_comparable=false` sin cambiar un terminal success. Los textos de
  contenido no pasan a las métricas.
- `effective_model_verified`, `provider_usage_coverage_verified` y
  `ready_for_model_comparison` siempre son false; `native_total_tokens` es null.

Antes de uso definitivo se necesitan captura controlada de todos los intentos,
prueba de identidad efectiva, semántica/cobertura del CLI/build, herramientas y
subllamadas, caché/razonamiento, fallos y contexto. La adaptación a evaluación
real requiere revisión independiente. No envolver un recibo nativo en el formato
sintético para atribuirle validación, ni usar estas fixtures para afirmar ahorro.

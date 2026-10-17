# Evidencia literal, contrato offline v1 (#43)

Estado: consumidor offline de [Snapshot v1](0007-integridad-fuente.md). Revisión
independiente y CI del candidato exacto se registran en el PR. No habilita #19,
modifica T2/B2 ni incorpora rutas, DB, modelos, extracción o UI de aprobación.

## Fuente y política confiables

`src/aulalista_api/source_evidence.py` recibe un `VerificationContext` con snapshot
controlado, digest retenido, propietario, ámbito y lista de targets esperados.
Cada target fija `id`, `representation_id`, `role` y `context_id` (los últimos dos
pueden ser null para una cita genérica). Las unidades del snapshot y esta política
son insumos confiables del consumidor; **no pueden salir de la respuesta que se
verifica**. La representación fijada impide que un resultado se cite a sí mismo.

El UUID de propietario y ámbito no acredita autenticación. El replay trabaja con
configuración local autorizada. Una integración runtime futura debe revalidar
actor/propiedad y resolver la versión en el servidor mediante sus contratos
vigentes; no se implementa aquí ni se acepta un contexto del cliente como permiso.

El contexto y las afirmaciones se congelan como cadenas JSON canónicas; las vistas
son copias. El digest del contexto liga propietario, ámbito, snapshot y targets.
Un cambio de versión, bytes, representación, anotaciones o política requiere un
contexto nuevo; una respuesta tardía no se redirige a la versión actual.

## Referencia y literalidad

Cada objeto `evidence` contiene exactamente propietario, ámbito, fuente, versión,
número de versión, SHA del original, SHA del snapshot, ID/SHA de representación,
página física base 1, `start`, `end` y `quote`. Los offsets son índices Python de
caracteres Unicode, base cero, intervalo semiabierto, dentro de esa página y cadena.
No son bytes UTF-8 ni coordenadas de un PDF/PNG. `reference` construye un objeto a
partir del contexto, pero no le otorga un veredicto.

Para `kind=literal` se comprueban todos los enlaces y rangos, página legible,
fragmento no vacío y `quote == source[start:end]`. Cada valor (cadena o elemento
de una lista no vacía) debe estar entero dentro de **una cita contigua**. No vale
reunir palabras dispersas, sumar páginas o encontrar valor y cita por separado.
Todas las referencias suministradas deben ser válidas, incluso las redundantes.

No hay normalización literal: NFC y NFD, signos, acentos, espacios, saltos de línea,
orden y caracteres parecidos permanecen distintos. `candidates` permite localizar
páginas con casefold y descomposición sin acentos, pero no produce offsets ni
estado literal. Nunca se convierte un candidato tolerante en evidencia exacta.

Cuando el target exige papel o contexto, **la cita completa** debe quedar dentro
de una unidad de fuente que cumpla ambos. Un material no se convierte en indicador
ni una sesión respalda otra por tener las mismas palabras. Si la fuente no tiene
la anotación necesaria, queda `unknown`, con motivo de insuficiencia. Un
`declared_role` del modelo no crea esa anotación. El núcleo valida la consistencia
de los intervalos; no certifica por sí mismo el trabajo del anotador.

`literal` significa presencia física mecánicamente comprobada, no entailment,
verdad ni corrección curricular. Un substring no interpreta negaciones, obligación,
condicionales o validez pedagógica. Este corte no es un juez semántico.

## Estados y derivaciones limitadas

- `literal`: coincidencia mecánica contra la representación fijada.
- `derived`: cálculo comprobado con regla soportada y entradas verificadas.
- `inferred`: propuesta/interpretación; citar texto real no la vuelve literal.
- `unknown`: ausencia, evidencia insuficiente, referencia inválida o regla no
  soportada. El dato y su motivo siguen visibles.
- `conflict`: declaraciones incompatibles o conflicto explícito, sin ganador
  automático ni contenido inventado para completarlo.

La única whitelist de derivación es `sum_integers` / `multiply_integers`. Requiere
1–128 targets de entrada distintos y presentes, cada uno `literal` o `derived`.
Los valores de entrada son enteros ASCII no negativos canónicos de hasta diez
caracteres; no se aceptan ceros iniciales salvo `0`. El resultado debe coincidir
exactamente y caber en un entero firmado de 64 bits positivo o cero. Se conservan
regla, IDs, valores y digest de cada resultado canónico de entrada. Dependencias
faltantes, inferidas, conflictivas o cíclicas no pasan.

Además, cada operando literal debe corresponder a un token entero completo en el
**texto fuente**, inspeccionando vecinos fuera del fragmento citado. Recortar `1`
de `12`, `-1`, `1.2` o `1e3` no permite derivar con ese valor. Se rechazan también
signo Unicode, coma decimal, dígitos adyacentes Unicode, identificadores, unidad
pegada, fracciones, componentes de hora/ratio con dos puntos y formatos
separados ambiguos. Un punto final no seguido de
un dígito puede terminar una oración. Los vecinos usan una whitelist: blancos, límites de cadena,
comillas/paréntesis y puntuación de oración controlada; símbolos o puntuación
adyacentes desconocidos obligan a abstenerse, también al otro lado de blancos.
Punto/coma sólo terminan el entero ante fin, blancos o cierre de comillas/paréntesis;
la repetición o continuación numérica se rechaza.
Es una comprobación léxica conservadora, no un parser universal de números, unidades o locales; se abstiene ante formatos
no soportados. Un literal genérico puede seguir siendo substring físico.

`arithmetic_verified` no verifica unidades, pertinencia de sumar esas magnitudes
ni significado. No se ejecutan reglas arbitrarias ni expresiones del modelo.
Los casos semánticos o cálculos no soportados permanecen propuestos/insuficientes.

## Proyección canónica y recuperación

`VerifiedBatch` conserva sólo contexto y afirmaciones originales canónicas.
`project()` vuelve a verificar todo; `serialize()` incluye esa misma proyección.
`restore()` exige el digest retenido, el contexto fijado y una recomputación
idéntica. No existe un flag persistido `checked`/`backed` con autoridad independiente.
Esos atributos en una entrada no se copian como estado del resultado. Una vista
modificada, archivo con veredicto forjado o cambio de contexto no resucita un dato.

La lista confiable de targets fija el denominador: cada target aparece una vez,
incluso ausente. Declaraciones extra se conservan aparte como diagnósticos y no
suman crédito. Duplicados idénticos sólo cuentan una vez; valores/kinds distintos
producen conflicto; un duplicado inválido impide acreditar el grupo por otra
ocurrencia válida. La proyección es independiente del orden de las entradas.
Un fallo no impide usar los otros targets independientes. El compilador legado no
se migra ni se modifica el matcher v2 o las regresiones de #7/#9.

## Consumidor, evidencia y límites

[`document_checks.claims_replay`](../../document_checks/README.md) ejecuta este
validador sobre una selección explícita de afirmaciones guardadas, con originales,
revisión y comprobaciones posteriores separados. Verifica bytes de fuentes y
respuestas, recompone los snapshots y reabre los lotes canónicos. La selección,
política y adjudicación vienen de configuración confiable, no se deducen ni se
certifican automáticamente por el CLI. Un hash del original no prueba que una
selección arbitraria sea fiel: esa correspondencia debe revisarse explícitamente.

La aceptación privada de este corte usa **tres targets originales seleccionados
por agentes** de respuestas ya vistas y **una comprobación de ubicación aparte**.
Dos originales son decidibles mecánicamente: página incorrecta y acento desplazado;
quedan insuficientes. La paráfrasis permanece inferida/no decidible semánticamente.
La ubicación correcta se comprueba aparte como literal, sin editar la respuesta.
Frente a esa adjudicación por agentes: cero aceptaciones indebidas entre dos
originales mecánicamente rechazables, cero falsos rechazos entre una comprobación
aceptable y un caso no decidible de cuatro comprobaciones. El denominador de
aceptables en los originales es cero: no se publica una tasa de rechazo sobre cero.

Esta selección no audita toda la respuesta, no es holdout, precisión general,
validación humana/docente ni NEM. Cero llamadas nuevas a modelos. Los hashes del
original y respuestas se contrastan con recibos previos; los del texto/vistas
históricos que no tenían digest se retienen por primera vez en este replay y así
se declaran. No se inventa congelación previa ni corrección de la extracción.

Código stdlib y fixtures nuevos de software, basados en contratos #42/#43 y specs
0001/0002. Sin copiar código/corpus del monolito sin licencia comprobada. Los
recibos reales, anotaciones, textos, respuestas, IDs y hashes privados quedan
fuera del repositorio, logs y CI. La biblioteca no es un sandbox de archivos
hostiles ni un servicio de red. Los tests sintéticos prueban software, no OCR.

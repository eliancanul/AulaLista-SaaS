# T4: puntuación independiente del orden de afirmaciones duplicadas

Referencia técnica e historial del corte. Consulta [Issues y fuentes de verdad](README.md) para elegir trabajo y consultar su estado actual.

Issue: [#7](https://github.com/eliancanul/AulaLista-SaaS/issues/7).
Integración histórica: [PR #8](https://github.com/eliancanul/AulaLista-SaaS/pull/8), integrado el 2026-10-16 a las 01:05:33 UTC en `0c5089836550528823c3903bacdf742331b84770`.
El [recibo de integración](https://github.com/eliancanul/AulaLista-SaaS/pull/8#issuecomment-6205685421) registra árbol revisado y CI postmerge del SHA integrado. Los checks locales descritos abajo pertenecen a la preparación de ese corte.
Base de preparación: `862f1d4e3a46ceb3de4253356c0ca0dd8993d40e`.

## Fallo y corte

El matcher retenía la primera afirmación válida de cada pareja
`subject`/`predicate`. Una respuesta con un valor correcto seguido por otro
contradictorio obtenía crédito; invertirlos lo quitaba.

Agrupar las afirmaciones válidas y comprobar todas por dimensión es suficiente.
Una clave obtiene un único crédito de valor si todas sus afirmaciones coinciden
con la referencia, y de evidencia si cada una aporta por separado todas las
citas requeridas. El crédito conjunto requiere ambas garantías. Duplicados
idénticos conservan el crédito único; citas distintas corroborantes también
pueden cumplir. No se permite ocultar una cita fabricada con otra correcta ni
combinar citas parciales de distintas afirmaciones. La política es conservadora
y mecánica, no una adjudicación semántica.

Las afirmaciones malformadas conservan el comportamiento previo: se excluyen del
cálculo por campo, se cuentan como inválidas y hacen `schema_valid=false`.
Los diagnósticos existentes y denominadores no cambian. La revisión semántica
sigue siendo obligatoria y no se afirma evidencia docente.

## Alcance y aceptación

- Único escritor: agente `preparar_backend_nube`, candidato aislado cloud.
- Runtime: `evaluation/scripts/benchmark.py`, función `score`, su CLI y tests.
- Regresión: duplicados idénticos, contradicción, tercera repetición, cita
  fabricada y cita corroborante distinta; ambos órdenes y contadores críticos.
- Documentar matcher v2 en contrato/README y renovar manifiesto de 29 archivos.
  El manifiesto previo se conserva en Git y en evidencia local; comparar
  candidatos requiere reevaluarlos con el mismo matcher.
- Sin cambios de API, UI, dependencias, datos de referencia, prompts o workflows.

## Evidencia local, 2026-10-16 UTC

Python 3.12.14. Base exacta: todos los blobs materializados se verificaron contra
el árbol remoto por SHA Git antes de editar. Baseline: 58/58 pruebas.
La regresión contra el scorer original falla por crédito contradictorio y por
dependencia del orden. Con el cambio: 59/59 normales y 59/59 con `-O`.
`freeze.py verify` confirma los 29 archivos del manifiesto nuevo.

Comandos:

```sh
python3 -B evaluation/scripts/freeze.py verify --root evaluation --input evaluation/manifests/input.manifest.json
python3 -B -m unittest discover -s evaluation/tests -v
python3 -B -O -m unittest discover -s evaluation/tests -v
```

Son pruebas del instrumento con datos sintéticos, no mejora curricular medida.
No se ejecutaron UI, PostgreSQL, corpus privado, modelos o APIs de pago.
No autoriza publicación, merge ni despliegue. Recuperación: revertir este corte
completo, incluido contrato y manifiesto; no mezclar métricas v1 y v2.

# T4: conservar dependencias al deduplicar

Referencia técnica e historial del corte. Consulta [Issues y fuentes de verdad](README.md) para elegir trabajo y consultar su estado actual.

Issue: [#9](https://github.com/eliancanul/AulaLista-SaaS/issues/9).
Integración histórica: [PR #10](https://github.com/eliancanul/AulaLista-SaaS/pull/10), integrado el 2026-10-16 a las 01:18:36 UTC en `d611d8faf54fde3efd64a4c866d327c90679ab56`.
El [recibo final del PR](https://github.com/eliancanul/AulaLista-SaaS/pull/10#issuecomment-6205844030) registra revisión/árbol verificados y CI postmerge del SHA integrado. No es evidencia de los candidatos posteriores.

## Base de preparación histórica

El candidato se preparó apilado sobre PR #8 antes de su integración. Tras integrar #8, PR #10 se dirigió a `main` con base `0c5089836550528823c3903bacdf742331b84770` y renovó su CI, según el PR.
Base de preparación: `0598e61e70fb584cbee878dee1f2255b05c678c8`.
Árbol base: `f07cd7fafbc3831b62fca49a3f1bb386c78bcc34`.

## Problema y corte

La clave anterior kind/text/unit fusionaba cabeceras y pies con dependencias o
metadata distintas. Sobrevivían sólo las relaciones de la primera ocurrencia.
La clave nueva serializa todos los campos JSON originales excepto id/page, sin
introducir una reconstrucción semántica. Se ignora sólo el orden de claves de
objetos; se conservan tipos, orden de listas, campos ausentes y texto exacto.
Diferencias conservadoras pueden reducir la compresión, pero no descartan datos.

Sólo cabeceras/pies preanotados dedup_safe son elegibles. Cada ocurrencia realmente
equivalente conserva id/page en aliases. El cierre transitivo se selecciona sobre
la fuente original antes de deduplicar; una dependencia a una ocurrencia fusionada
sigue resolviendo mediante aliases. No se reescriben IDs ni se unen dependencias.
El campo aliases de salida sigue siendo procedencia generada por el instrumento;
no es una interfaz para encadenar fuentes previamente deduplicadas.

## Alcance y aceptación

- Único escritor: conservar_dependencias_dedup, candidato cloud aislado.
- Función deduplicate, consumidores requests full/dedup/segmented y tests.
- Ambos tipos de bloque, dos órdenes, tres repeticiones, dependencia diferente,
  ausente o vacía, destino inválido, metadata adicional/anidada y diferencias de
  tipo, null/ausencia, orden de listas, texto parecido, unidad y dedup_safe.
- Equivalencia real comprime y conserva todos los aliases, sin mutar la fuente.
- Dependencias transitivas cruzadas y referencia a alias conservadas en solicitudes.
- Contrato v3 documenta preprocesador v2; matcher v2 de PR #8 no cambia.
- Sin cambios de UI, API, prompts, fuentes/referencias, paquetes o workflows.

## Evidencia local, 2026-10-16 UTC

La copia completa de 91 archivos reproduce el árbol Git de PR #8; su freeze previo
SHA256 `7a244102c74cd3f9d4370b79e9f6ed40dd82bc7e421583c07352973a59485fb3`
se verificó antes de copiar. No se modifica la fuente compartida.
Python 3.12.14, Ruff 0.17.0. Baseline: 59/59 pruebas. Los nuevos tests contra
la implementación anterior producen 37 subcasos rojos. Candidato: 62/62 pruebas
normales y 62/62 optimizadas, manifiesto de 29 archivos válido, lint y formato
correctos en todo el árbol.

```sh
python3 -B evaluation/scripts/freeze.py verify --root evaluation --input evaluation/manifests/input.manifest.json
python3 -B -m unittest discover -s evaluation/tests -v
python3 -B -O -m unittest discover -s evaluation/tests -v
ruff check .
ruff format --check .
```

La revisión independiente y CI del candidato integrado están en el PR enlazado;
esta sección describe únicamente los checks locales de preparación.
No se ejecutaron UI, PostgreSQL ni modelos; no se midieron calidad curricular o
ahorro de tokens. No hay publicación, merge ni despliegue acreditados por estos
checks locales. Recuperación: revertir este corte con contrato y manifiesto; las
solicitudes de comparación deben regenerarse con el mismo preprocesador.

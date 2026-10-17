# Asset provenance and validation

## Corrección de integridad, 2026-10-16

El primer intento de descarga por URL guardó 14 respuestas HTML «Site Unavailable»
con extensión .svg (195 bytes; SHA256
5b131ca14aa96311d3432b0062c7443d3b0e6346ec279bd376a75f0a76bcd5d7).
La existencia del archivo no demostraba una descarga SVG correcta. Esos bytes
fueron rechazados y reemplazados; no se atribuye una causa de red no comprobada.

Los 14 SVG actuales son exportaciones completas, sin cambios de paths ni estilos,
de nodos existentes mediante Figma Plugin API `exportAsync({format:'SVG_STRING'})`,
a través del conector oficial en modo de sólo lectura. No se modificó Figma.
Referencia de API: https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/
Archivo fuente: https://www.figma.com/design/WEmZPyqYaUjBpY2fMhXItU

| Archivo | Nodo exportado | Tamaño raíz SVG |
| --- | --- | --- |
| send.svg | 2:59 | 24 × 24 |
| brand-symbol.svg | I43:2619;37:268;37:260 | 42 × 35 |
| brand-wordmark.svg | I43:2619;37:272 | 102 × 23 |
| expand.svg | I30:364;2:138 | 24 × 24 |
| plus.svg | I30:364;2:141 | 24 × 24 |
| home.svg | I30:364;2:144 | 24 × 24 |
| search.svg | I30:364;2:147 | 24 × 24 |
| folder.svg | I30:364;2:150 | 24 × 24 |
| chat.svg | I30:364;2:153 | 24 × 24 |
| settings.svg | I30:364;2:157 | 24 × 24 |
| microphone.svg | I34:2089;34:1981;34:1966 | 20 × 20 |
| document.svg | I34:2110;43:2644;43:2632 | 20 × 20 |
| search-small.svg | I34:2110;43:2648;43:2636 | 20 × 20 |
| folder-small.svg | I34:2110;43:2653;43:2641 | 20 × 20 |

La raíz exportada de símbolo/wordmark redondea los límites fraccionarios de los
nodos (41.25×34.25 y 101.75×22.625). No se alteraron los atributos de exportación.
Esas piezas están conservadas como fuentes; la UI usa el logo completo del paquete.
Los iconos usados mantienen sus dimensiones intrínsecas de 24 o 20 px.

## Paquete aprobado y fuentes

- Logo completo: `acenta-logo-reconstruido-tinta.svg`, reconstrucción vectorial
  autorizada de Figma 37:267, no el master original de marca. No se declara exactitud
  respecto a un original no disponible.
- Foto: `foto-aprobada-recorte.png`, recorte aprobado incluido en el paquete de
  integración, 784×769. Su importación a Figma falló HTTP405; el uso en código es
  una diferencia explícita frente al placeholder del diseño, no una foto inventada.
- Google G: `google-g-oficial.svg`, bytes originales del paquete aprobado, raíz
  SVG válida 20×20. Incluye foreignObject con gradiente; el renderizador CairoSVG
  sólo muestra parte. **La verificación visual en Chromium está pendiente**.
  No se reemplazó ni redibujó. Una integración GIS real requiere botón/proveedor
  y reglas de marca correspondientes, aún fuera de este corte.
- Instrument Serif Regular: https://github.com/google/fonts/tree/main/ofl/instrumentserif
  SHA256 498efd461f6ddfcb7a111bf9a565709d2085d48201d501ead960d93e84ffbb88.
- Source Sans 3 Regular/Semibold: https://github.com/adobe-fonts/source-sans/tree/release/TTF
  Regular SHA256 4644c81b86ec9caaa76b634889968ed3c4f4f52f054855933acc7c2b21e53b0f;
  Semibold SHA256 a3f4f8dcf343a8f24dc61951de93f3ba1558b15cd250ba24af8a40e957081b7d.
  Bytes verificados contra fuentes oficiales; licencias SIL OFL incluidas.

## Alcance de la comprobación

`asset-manifest.json` registra MIME por contenido, bytes, hash y dimensiones/tablas
para los 20 assets. `tests/validate_assets.py` analiza XML SVG, raíz/dimensiones,
contenido activo/referencias externas, firma y CRC PNG, y firma/directorio/tablas
TrueType. Las pruebas rechazan el caso HTML guardado como SVG y formatos corruptos.
Inspección adicional con Pillow y FontTools verificó PNG y las tres fuentes.
Los 14 SVG recuperados se renderizaron e inspeccionaron; eso no demuestra el layout
ni el comportamiento del navegador. No hay captura de UI ejecutada aún.

Snapshots oficiales: inicio 20:436, editor 22:299, resultado 22:264, contexto 78:334,
adjuntar 85:334, herramientas 91:334, acceso 97:226 y correo 107:602. El snapshot
2026-10-16 22:43 UTC conserva el cambio humano de «Bienvenido» a 96px y sustituye
el texto de 38px del paquete anterior. El titular derecho eliminado está ausente.

Assets y fuentes se sirven localmente. No hay URL temporal Figma en el runtime,
CDN de fuentes, configuración OAuth ni transmisión de marketing.

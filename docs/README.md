# Documentación del facilitador

| Documento | Para quién | Qué contiene |
|---|---|---|
| [`playbook-facilitador.docx`](playbook-facilitador.docx) | Facilitador | Cómo preparar, recibir, dar las instrucciones, conducir y cerrar un ejercicio hasta la entrega del informe. Anexos: incidencias técnicas, avisos tipo, lista de comprobación del día y hoja de observación |
| [`tarjeta-participantes.docx`](tarjeta-participantes.docx) | Participantes | Una página: cómo entrar, dónde está cada cosa en las gafas, cómo decidir, botones útiles y qué hacer al terminar |
| Guion de cada ejercicio | Facilitador | No es un fichero: se imprime desde la consola del facilitador (`/facilitador/`, botón *Imprimir guion*). Se genera desde el pack, así que siempre está al día. Incluye la clave de respuestas solo si está marcada *Mostrar la clave de respuestas* |

Los documentos son genéricos: valen para cualquier ejercicio del kit y no nombran a ninguna organización real.

## Al editar los .docx

El control de anonimato (`node tools/comprobar-anonimato.mjs`, también en la integración continua) revisa el
texto y los metadatos de los documentos Office. Word guarda el nombre de quien edita como autor: antes de subir un
documento editado, en Word, *Archivo → Información → Inspeccionar documento → Propiedades del documento e información
personal → Quitar todo*, y vuelve a guardar. Solo se admiten `.docx`, `.pptx` y `.xlsx`; los PDF y los formatos
antiguos (`.doc`, `.ppt`, `.xls`) no se pueden revisar y se rechazan.

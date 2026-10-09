# landingcorys
landing corys fast

## Configuración del menú interactivo (Google Sheets)

El menú (`menú1.html`, archivo de pruebas) lee los datos desde una sola hoja de Google Sheets con 3 pestañas: `menu`, `config` y `zonas`.

1. Crea una hoja de Google Sheets con 3 pestañas llamadas exactamente `menu`, `config` y `zonas`.
2. Importa a cada pestaña su archivo de plantilla correspondiente de este repositorio: `menu.csv` → pestaña `menu`, `config.csv` → pestaña `config`, `zonas.csv` → pestaña `zonas`.
3. En cada pestaña: **Archivo → Compartir → Publicar en la web** → selecciona esa pestaña → formato CSV → Publicar.
4. Copia los 3 enlaces generados y pégalos en `menú1.html`, en las constantes `PRODUCTS_CSV_URL`, `CONFIG_CSV_URL` y `ZONAS_CSV_URL`.
5. Abre `menú1.html` y prueba: edita un precio o marca un producto como destacado en `menu`, cambia la tasa o el horario en `config`, o agrega una zona en `zonas` — los cambios se reflejan en el menú (puede tardar unos minutos por el caché de Google).

Si una pestaña no se configura (o falla al cargar), el menú sigue funcionando normal con los valores por defecto, sin errores visibles para el cliente.

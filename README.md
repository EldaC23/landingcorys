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

## Para desarrolladores: integraciones futuras

Esta sección es solo una guía técnica para quien quiera, por su cuenta, conectar el menú con una pasarela de pagos, un sistema de facturación o un sistema de inventario. **Estas integraciones no están incluidas en el menú entregado**; nada de esto se construyó ni se probó en este repositorio.

### 1. Qué es el menú hoy

- Página estática, sin servidor propio, servida por GitHub Pages.
- Los datos (productos, configuración, zonas de envío) se leen en el navegador desde las pestañas `menu`, `config` y `zonas` de una hoja de Google publicada como CSV.
- El pedido se arma por completo en el navegador (carrito, totales, validación) y se entrega al negocio enviando un mensaje de WhatsApp. No hay backend, base de datos ni API propia.

### 2. Puntos de enganche en el código

Nombres reales tal como existen hoy en `menu.html` (el menú del cliente) y `menú1.html` (archivo de pruebas, mismo código salvo lo indicado):

- `window.sendWhatsApp()`: arma el texto final del pedido (productos, cantidades, entrega, pago, total) y es el único lugar donde el pedido "sale" del navegador. Es el punto natural para agregar un envío a un servidor propio.
- `cart` (objeto): estado del carrito en memoria — id de producto → cantidades/personalización. Se recorre dentro de `sendWhatsApp()` para armar las líneas del pedido.
- `orderMeta` (objeto): datos del pedido — `deliveryType`, `address`, `zone`, `paymentMethod`.
- `computeShipping()`: calcula el costo de envío según la zona elegida en `orderMeta.zone`, buscando en el arreglo `zonas`.
- `appConfig` (objeto): configuración cargada desde la pestaña `config` (tasa en bolívares, horario, métodos de pago, promo).
- `zonas` (arreglo): zonas de envío con su precio, cargadas desde la pestaña `zonas`.
- **Diferencia entre archivos:** en `menú1.html`, `sendWhatsApp()` no envía nada real — abre un modal de demostración (`#demo-modal`) con el mensaje armado, sin enviarlo a ningún número. En `menu.html` esa parte fue reemplazada: `sendWhatsApp()` abre directamente `https://wa.me/<número real>?text=...` con el mensaje. Cualquier integración que dependa de "cuándo se envía el pedido" debe engancharse en `menu.html`, no en el archivo de pruebas.

### 3. Por qué hace falta un servidor

GitHub Pages solo sirve archivos estáticos: no puede guardar pedidos, ni proteger claves de pagos o de APIs (cualquier clave puesta en el HTML es pública). Para cualquiera de estas integraciones hace falta un servidor o función que sí pueda guardar datos y mantener claves privadas. Opciones habituales:

- Google Apps Script (se integra bien con Google Sheets, que ya es la fuente de datos actual).
- Funciones serverless (Cloudflare Workers, Vercel, Netlify).
- Un servidor propio (Node, PHP, etc.).

### 4. Esquema general de integración (pasos)

1. Definir qué se automatiza y en qué orden (registro de pedidos, cobro, facturación, inventario).
2. Montar el servidor y un endpoint que reciba el pedido en formato JSON.
3. Modificar la función que envía el pedido (`sendWhatsApp()` en `menu.html`) para que, además de abrir WhatsApp, haga un `fetch` POST al endpoint. WhatsApp puede quedar como aviso al negocio en paralelo.

   ```js
   // Ejemplo ilustrativo, no es código del proyecto:
   fetch('https://mi-servidor.ejemplo/pedidos', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ cart, orderMeta })
   });
   ```

4. El servidor guarda el pedido y llama a los demás servicios (pagos, facturación, inventario); las claves de esos servicios viven solo en el servidor, nunca en el HTML.
5. Recalcular los precios en el servidor a partir del catálogo: hoy los precios viven en el navegador (en el objeto `products`, derivado del CSV) y cualquiera puede alterarlos desde las herramientas de desarrollador antes de enviar el pedido. En cuanto haya cobros reales, esto es obligatorio: el servidor debe recalcular el total contra su propia copia del catálogo, no confiar en lo que mande el navegador.
6. Pagos: elegir un proveedor que opere en Venezuela y manejar la confirmación del pago del lado del servidor.
7. Facturación: conectarse al sistema o proveedor fiscal que use el negocio, validando los requisitos legales aplicables.
8. Inventario: un catálogo con stock que baje al confirmar cada pedido; considerar que parte de los pedidos del negocio puede no pasar por este menú (ventas en el local, por teléfono, etc.), así que el inventario no puede depender solo de esta fuente.
9. Pruebas y mantenimiento: cualquier integración externa puede fallar (caída del proveedor de pago, cambios en su API, etc.) y alguien debe quedar a cargo de monitorearla y atenderla.

### 5. Envío por kilómetros (opcional)

Hoy el costo de envío se calcula por zonas fijas definidas en la pestaña `zonas` (`computeShipping()`), no por distancia. Calcular por kilómetros requeriría las APIs de Google Maps (Distance Matrix o similar), que necesitan una clave con facturación activa en Google Cloud y cobran por consulta.

### Nota final

Estas integraciones no están incluidas en el menú entregado; esta sección es solo orientativa.

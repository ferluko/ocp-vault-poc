# appointment
OpenAPI appointment example

Este es un ejemplo de la API appointment del [TMForum](https://www.tmforum.org/ "TMForum")

#### Pasos previos:
- El servicio requiere de una base MongoDB donde crea, consulta, actualiza y elimina las citas (C-R-U-D)
- Se deben configurar las variables de entorno para que se establezca la conexión (USER, PASS, IP, PORT y DATABASE)

##### Pasos a seguir:
- Instalar dependencias
`$ npm i`

- Iniciar el servicio
`$ npm start`

-------------
El servicio se expone en el port 8080 y puede accederse al contrato de la API con el swagger correspondiente (/api-docs)

# ocp-vault-poc
Prueba de Concepto para la integración de Hashicorp Vault en Openshift para Aplicaciones "No native Vault logic built-in".
 
## Introducción

Estas instrucciones permitirán obtener una copia la PoC en funcionamiento en tu máquina local para propósitos de depliegue y pruebas.

### Pre-Requisitos

_En tu maquina local._
* [Openshift CLI] (https://docs.openshift.com/container-platform/4.2/cli_reference/openshift_cli/getting-started-cli.html) - Instalado y login configurado contra el cluster OCP
* [Vault CLI 1.4] (https://www.vaultproject.io/docs/install#precompiled-binaries) - Cliente CLI Vault 

## Comenzando
_En tu maquina local._

Clonamos el repositorio y creamos el proyecto ```vault-app``` en Openshift

```
git clone https://github.com/ferluko/ocp-vault-poc.git
cd ocp-vault-poc
oc new-project vault-app
```
### Despliegue MongoDB
Para la persistencia de los datos de la aplicación ```vault-app-api```  se utiliza un backend de base de datos MondoDB.

_Despliegue de MongoDB en OCP donde se incluya la creación de secrectos de K8s para la incializacion de motor de base de datos MongoDB Ephemeral. La inicialización de la imagen de MongoDB utiliza las variables de entorno especificadas en el archivo de despliegue._
```
oc create -f mongodb/010-deploy-secret-mongodb-service.yaml 
```

## ESCENARIO 0 - ESCENARIO ORIGINAL

### Construcción (Building) de la aplicación demo
Para el **build** de la aplicación utilizamos el código que se encuenta en la carpeta **appointment** del repositorio (branch **Master**) y la llamamos ```vault-app-api```

```oc new-build https://github.com/ferluko/ocp-vault-poc.git --context-dir appointment --name vault-app-api```
Observar el progreso con ```watch oc status --suggest``` o con ```oc logs -f vault-app-api-1-build```

A continuación desplegamos la aplicación ```vault-app-api``` con la imagen del último **build**. Las credenciales, el nombre de la base, IP y puerto que serán del string de conexión a MongoDB serán provistos por **variables de entorno** utilizando los **Secretos de K8s** , los mismos que previamente fueron utilizados para inialización de la misma base de datos. De esta forma representamos un escenario original donde los secretos de una aplicacion (string de conexión) son variables de entorno, es decir secretos de K8s.
``` 
oc create -f example00/020-deployConfig-api.yaml
oc expose svc vault-app-api
oc status --suggest
```
_NOTA: A modo ejemplo de esta PoC se pueden observar los logs del POD de la aplicación donde se muestra por consola el string de conexión a la base de datos ```oc logs -f vault-app-api```_

URL para probar la APP: http://vault-app-api-vault-app.apps.ocp4.labs.semperti.local/api-docs/ (http://vault-app-api-vault-app.apps.ocp4.labs.semperti.local/api-docs/) 
Utilizando Swagger podemos simular el uso de esta API realizando varios POST comprobando la conexión a la base de datos.
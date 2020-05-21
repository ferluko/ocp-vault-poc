# ocp-vault-poc
Prueba de Concepto para la integración de Hashicorp Vault en Openshift para Aplicaciones "No native Vault logic built-in".
 
## Introducción

Estas instrucciones permitirán obtener una copia la PoC en funcionamiento en tu máquina local para propósitos de depliegue y pruebas.

### Pre-Requisitos

_En tu maquina local._
* [Openshift CLI](https://docs.openshift.com/container-platform/4.2/cli_reference/openshift_cli/getting-started-cli.html) - Instalado y login configurado contra el cluster OCP
* [Vault CLI 1.4](https://www.vaultproject.io/docs/install#precompiled-binaries) - Cliente CLI Vault 

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

URL para probar la APP: http://vault-app-api-vault-app.apps.ocp4.labs.semperti.local/api-docs/ 
Utilizando Swagger podemos simular el uso de esta API realizando varios POST comprobando la conexión a la base de datos.

### Instalación de Hashicorp Vault Server en OCP
_En tu maquina local._

```
cd -
oc new-project hashicorp
git clone https://github.com/ferluko/hashicorp-vault-for-openshift.git
cd hashicorp-vault-for-openshift
```
_**NOTA INTERNA:** Para el almacenamiento de todos los secretos, el siguiente despliegue de Vault utiliza un Phisical Volumen (PV) llamado **vault-storage**, en el nodo bastion de nuestro lab se encuentra el siguiente script para crear el NFS export y mapearlo al PV que luego utilizará Vault para su instalación._
```
sudo ./nfs.sh 
>/exports/vault-storage
exit
```

Creamos el **Kubernetes System Account:** ```vault-auth``` y los asignamos a todos los proyectos, este SA será ultilizado para la autientificación de los PODs con **Vault** utilizando [**Kubernetes Auth Method**](https://www.vaultproject.io/docs/auth/kubernetes). Recomendamos reforzar su conocimiento leyendo como funciona este método en la documentacion adicional.
```
oc create sa vault-auth
oc adm policy add-cluster-role-to-user system:auth-delegator -z vault-auth
```

Instalación de **Hashicorp Vault** en formato ```standalone```. Los siguientes objetos de Kubernetes serán creados:
* vault-server-binding ClusterRoleBinding
* vault ServiceAccount
* vault-config ConfigMap
* vault Service
* vault Deployment
* vault Route
* vault NetworkPolicy
>
> vault-server-binding ClusterRoleBinding allows vault service account to leverage Kubernetes oauth with the oauth-delegator ClusterRole
>
```
oc apply -f ./vault/standalone/install/
watch oc status --suggest
```

#### Inicialización de Vault
```
POD=$(oc get pods -l app.kubernetes.io/name=vault --no-headers -o custom-columns=NAME:.metadata.name)
oc rsh $POD
```
Remote Shell al Pod de Vault, osea dentro del pod de vault ejecutamos:
```
vault operator init --tls-skip-verify -key-shares=1 -key-threshold=1
```
Tomar nota de forma segura ```Unseal Key 1```  y el ```Initial Root Token```:
```
Unseal Key 1: n4Ju98iDxJXhNLVNgNHSGA+/C0m+SB9wE/BCdTRMmMg=
Initial Root Token: s.JmItROuk2vfOrA1u9UmTReqY
```
Y exportarlas como variables de enternos para futuro uso:
```
export KEYS=n4Ju98iDxJXhNLVNgNHSGA+/C0m+SB9wE/BCdTRMmMg=
export ROOT_TOKEN=s.JmItROuk2vfOrA1u9UmTReqY
export VAULT_TOKEN=$ROOT_TOKEN
```
#### Unseal de Vault
```
vault operator unseal --tls-skip-verify $KEYS
```
Deberiamos tener un _output_ como el siguiente:
>
>Key             Value
>---             -----
>Seal Type       shamir
>Initialized     true
>Sealed          false
>Total Shares    1
>Threshold       1
>Version         1.3.2
>Cluster Name    vault-cluster-a1531371
>Cluster ID      1c6d4c42-d82b-411d-9e8c-363f92e52ee4
>HA Enabled      false
>
```exit``` para salir del **shell** del **POD**.
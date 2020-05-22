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
Observar el progreso con 
```watch oc status --suggest``` 
o con
 ```oc logs -f vault-app-api-1-build```

A continuación desplegamos la aplicación ```vault-app-api``` con la imagen del último **build**. Las credenciales, el nombre de la base, IP y puerto que serán del string de conexión a MongoDB serán provistos por **variables de entorno** utilizando los **Secretos de K8s** , los mismos que previamente fueron utilizados para inialización de la misma base de datos. De esta forma representamos un escenario original donde los secretos de una aplicacion (string de conexión) son variables de entorno, es decir secretos de K8s.
``` 
oc create -f example00/020-deployConfig-api.yaml
oc expose svc vault-app-api
oc status --suggest
```
_NOTA: A modo ejemplo de esta PoC se pueden observar los logs del POD de la aplicación donde se muestra por consola el string de conexión a la base de datos
```oc logs -f vault-app-api```_

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
```
Key             Value
---             -----
Seal Type       shamir
Initialized     true
Sealed          false
Total Shares    1
Threshold       1
Version         1.3.2
Cluster Name    vault-cluster-a1531371
Cluster ID      1c6d4c42-d82b-411d-9e8c-363f92e52ee4
HA Enabled      false
```
```exit``` para salir del **shell** del **POD**.

### Configuración de Vault
Aqui estaremos configurando el metodo de autenticación Kubernetes, este mismo se utilizá en los escenarios 1 y 2 para la obtención de secretos.
Utilizaremos la **SA**(System Account) ```vault-auth``` previamente creado, obtendremos su **token** de K8s y lo registraremos en **Vault** junto a su certificado asociado. De esta forma cada **POD** que se ejecute en K8s podrá autenticarse con Vault. Luego dependerá del **Role_ID** y de la politica asociada que se especifique para la obtención de los secretos. Complementar el entendimiento con la _Documentación Adicional_
```
oc project hashicorp

secret=`oc describe sa vault-auth | grep 'Tokens:' | awk '{print $2}'`
token=`oc describe secret $secret | grep 'token:' | awk '{print $2}'`
pod=`oc get pods | grep vault | awk '{print $1; exit}'`
oc exec $pod -- cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt > ca.crt
```
```$ROOT_TOKEN``` es el token que hemos tomado nota en el paso previo (instalacón de Vault)
```
export VAULT_TOKEN=$ROOT_TOKEN
export VAULT_ADDR=https://`oc get route | grep -m1 vault | awk '{print $2}'`

vault auth enable -tls-skip-verify kubernetes
vault write -tls-skip-verify auth/kubernetes/config token_reviewer_jwt=$token kubernetes_host=https://kubernetes.default.svc:443 kubernetes_ca_cert=@ca.crt

vault read -tls-skip-verify auth/kubernetes/config
rm ca.crt
```

## ESCENARIO 1: VAULT API CALL - INIT CONTAINER

### Configuración de Vault para el escenario 1
> _A realizar por seguridad informatica_

**_Datos de Vault:_**
**Policy:** policy-example
**Role:** demo
**Path secretos:** secret/mongodb
**Tipo:** KV v1
**SA:** default
**Tipo de Auth:** K8s

A continuación estamos habilitando el **Engine Key/Value (KV)** en el path `secret/mongodb` y le asignamos una política `policy-example` con capacidades de _Read_ y _List_ en el `path` mencionado.
```
vault secrets enable -tls-skip-verify -version=1 -path=secret/mongodb kv
vault policy write -tls-skip-verify policy-example ./policy/policy-example.hcl
``` 

Contenido del archivo `./policy/policy-example.hcl`:
```
path "secret/mongodb" {
  capabilities = ["read", "list"]
}
```

Con el siguiente comando estamos configurando en Vault el **role** `demo` con el **Kubernetes Auth Method** para la pólitica `policy-example` con un _Time-to-Live (TTL)_ de 24 horas.
``` 
vault write -tls-skip-verify auth/kubernetes/role/demo bound_service_account_names=default bound_service_account_namespaces='*' policies=policy-example ttl=24h
```
Leemos con el comando  `vault read`  lo que acabamos de configurar:
```
vault read -tls-skip-verify auth/kubernetes/role/demo

Key                                 Value
---                                 -----
bound_service_account_names         [default]
bound_service_account_namespaces    [*]
policies                            [policy-example]
token_bound_cidrs                   []
token_explicit_max_ttl              0s
token_max_ttl                       0s
token_no_default_policy             false
token_num_uses                      0
token_period                        0s
token_policies                      [policy-example]
token_ttl                           24h
token_type                          default
ttl                                 24h
```

Para la realización de la PoC vamos a leer (copiar) los secretos desde k8s y llevarlos a Vault, pero en un **entorno real** el departamento _Seguridad Informatica_ deberia crear los secretos en el **path**: `secret/mongodb` donde se encuentra el **engine KV** previamente configurado.
```
vault write -tls-skip-verify secret/mongodb user="$(oc get secret/mongodb -o jsonpath="{.data.MONGODB_USERNAME}" | base64 -d )" password="$(oc get secret/mongodb -o jsonpath="{.data.MONGODB_PASSWORD}" | base64 -d )"
```
Realizamos un `vault read` para leer los secretos, deberiamos tener el siguiente _output_:
```
vault read -tls-skip-verify secret/mongodb

Key                 Value
---                 -----
refresh_interval    168h
password            password
user                admin
```

Limpiamos el despliegue de la app: **vault-app-api** en el proyecto `vault-app` para dar comienzo al siguiente escenario.
```
oc project vault-app
oc delete all -l app=vault-app-api
oc get all
```

### Despliegue de aplicación agregando Init Container.

Para el corriente escenario, en el despliegue del POD de la aplicación **demo** le estaremos adicionando un **Init Container** para la obtención de los secretos (credenciales de conexión a mongoDB), bajar los secretos a un archivo (`/deployments/config/application.properties`) en un volumen compartido entre ambos containers (init y main container) que será accesible por el **Main Container**, es decir por la aplicación **demo**.

_**NOTA:** Para propósito de esta PoC, el código de la aplicación fué escasamente adaptado para leer los secretos desde `/deployments/config/application.properties`, de no existir este archivo los secretos serán obtenidos desde las variables de entorno como fué demostrado en el escenario 0._

Primero verificamos el **role** `demo` con **Kubernetes Auth Method** y con la pólitica `policy-example`
```
secret=`oc describe sa default | grep 'Tokens:' | awk '{print $2}'`
token=`oc describe secret $secret | grep 'token:' | awk '{print $2}'`
vault write -tls-skip-verify auth/kubernetes/login role=demo jwt=$token

Key                                       Value
---                                       -----
token                                     s.Mx3brVu6uk6yMJGC6R74Yf8K
token_accessor                            AceKHeY7HIGUKCUfdUK8M69g
token_duration                            24h
token_renewable                           true
token_policies                            ["default" "policy-example"]
identity_policies                         []
policies                                  ["default" "policy-example"]
token_meta_service_account_name           default
token_meta_service_account_namespace      vault-app
token_meta_service_account_secret_name    default-token-qpfwq
token_meta_service_account_uid            944b7f2f-2e1b-44e3-ba2a-ed4dec0cd528
token_meta_role                           demo
```

Desplegamos la aplicación `vault-app-api` y exponemos el servicio para ser accedide via HTTP por fuera del cluster OCP. 
_**NOTA:** Observar que no se ha realizado un nuevo Build de la aplicación, solo se ha modficado el despliegue de la misma agregando el **Init Container**.
```
oc apply -f example01/020-deployConfig-api.yaml
oc expose svc vault-app-api
```
Verificar los logs de deployment y de ejecución del init Container de modo didáctico.
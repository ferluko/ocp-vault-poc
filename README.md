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
```
watch oc status --suggest
oc logs -f vault-app-api-1-build
```

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
oc new-project hashicorp
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
* **Policy:** policy-example
* **Role:** demo
* **Path secretos:** secret/mongodb
* **Tipo:** KV v1
* **SA:** default
* **Tipo de Auth:** K8s

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
> _A realizar por Infraestructura (DevOps)_

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

Desplegamos la aplicación `vault-app-api` y exponemos el servicio para ser accesible vía HTTP por fuera del cluster OCP.
_**NOTA:** Observar que no se ha realizado un nuevo Build de la aplicación, solo se ha modficado el despliegue de la misma agregando el **Init Container**.
```
oc apply -f example01/020-deployConfig-api.yaml
oc expose svc vault-app-api
```
Verificar los logs de deployment y de ejecución del init Container a modo didáctico.

Limpiamos el despliegue de la aplicación `vault-app-api` para dar comienzo al siguiente escenario.
```
oc delete dc vault-app-api
```

## ESCENARIO 2:  VAULT AGENT INJECTOR - SIDECAR CONTAINER

### Configuración de Vault para el escenario 2
> _A realizar por Seguridad Informatica_

**_Datos de Vault:_**
* **Policy:** vault-app-policy-dynamic
* **Role:** vault-app-mongodb-role
* **Path secretos:** database/creds/vault-app-mongodb-role
* **Tipo:** Database (Mongodb plugin)
* **SA:** default
* **Tipo de Auth:** K8s

A continuación estamos habilitando el **Engine Database** para la utilización de los secretos dinámicos.
```
vault secrets enable -tls-skip-verify database
```

Luego configuramos el path `database/config/vault-app-mongodb` con el **plugin** `mongodb-database-plugin` y le asignamos el **role** `vault-app-mongodb-role`. Adicionalmente le indicamos el string de conexión para poder crear y revocar credenciales de forma dinamica en la base de datos. Las credenciales (root y password) son obtenidos desde los secretos de K8s del escenario original.
```
vault write -tls-skip-verify database/config/vault-app-mongodb \
   plugin_name=mongodb-database-plugin \
   allowed_roles="vault-app-mongodb-role" \
   connection_url="mongodb://{{username}}:{{password}}@mongodb.vault-app.svc.cluster.local:27017/admin" \
   username="admin" \
   password="$(oc get secret/mongodb -o jsonpath="{.data.MONGODB_ROOT_PASSWORD}" | base64 -d )"
```
Comprobamos la configuración realizada con `vault read`:
```
vault read -tls-skip-verify database/config/vault-app-mongodb

Key                                   Value
---                                   -----
allowed_roles                         [vault-app-mongodb-role]
connection_details                    map[connection_url:mongodb://{{username}}:{{password}}@mongodb.vault-app.svc.cluster.local:27017/admin username:admin]
plugin_name                           mongodb-database-plugin
root_credentials_rotate_statements    []
```

Le especificamos la capacidades del **role** `vault-app-mongodb-role` que podrá realizar en la base de datos. En este ejemplo le estamos dando un role **admin** para la base de datos llamada **sampledb**.

```
vault write -tls-skip-verify database/roles/vault-app-mongodb-role \
   db_name=vault-app-mongodb \
   creation_statements='{ "db": "sampledb", "roles": [{"role": "readWrite", "db": "sampledb"}] }' \
   default_ttl="1h" \
   max_ttl="24h" \
   revocation_statements='{ "db": "sampledb" }'

vault read -tls-skip-verify database/roles/vault-app-mongodb-role

Key                      Value
---                      -----
creation_statements      [{ "db": "sampledb", "roles": [{"role": "readWrite", "db": "sampledb"}] }]
db_name                  vault-app-mongodb
default_ttl              1h
max_ttl                  24h
renew_statements         []
revocation_statements    [{ "db": "sampledb" }]
rollback_statements      []
```

A continuacón estamos creando la política lllamda `vault-app-policy-dynamic` con capacidades de lectura para el **path** `database/creds/vault-app-mongodb-role`, crear y revocar _"leases".
```
vault policy write -tls-skip-verify vault-app-policy-dynamic policy/vault-app-dynamic-secrets-policy.hcl
```
Contenido de archivo `policy/vault-app-dynamic-secrets-policy.hcl`:
```
path "database/creds/vault-app-mongodb-role" {
  capabilities = ["read"]
}
path "sys/leases/renew" {
  capabilities = ["create"]
}
path "sys/leases/revoke" {
  capabilities = ["update"]
}	
```

Ya creado y configurado el **engine database** con el plugin de **MongoDB**, a continuación le estaremos diciendo a Vault que el **role** `vault-app-mongodb-role` que se autenticará vía metodo Kubernetes (con la SA `default` y desde cualquier namespace) con el alcance definido por la **policy**  `vault-app-policy-dynamic` con un TTL de 24hs.
```
vault write -tls-skip-verify auth/kubernetes/role/vault-app-mongodb-role bound_service_account_names=default bound_service_account_namespaces='*' policies=vault-app-policy-dynamic ttl=24h

vault read -tls-skip-verify auth/kubernetes/role/vault-app-mongodb-role

Key                                 Value
---                                 -----
bound_service_account_names         [default]
bound_service_account_namespaces    [*]
policies                            [vault-app-policy-dynamic]
token_bound_cidrs                   []
token_explicit_max_ttl              0s
token_max_ttl                       0s
token_no_default_policy             false
token_num_uses                      0
token_period                        0s
token_policies                      [vault-app-policy-dynamic]
token_ttl                           24h
token_type                          default
ttl 
```

### Despliegue de aplicación con la utilización de Vault Agent Injector.
> _A realizar por Infraestructura (DevOps)_

#### Vault Agent
Vault Agent realiza tres funciones, las dos primeras ya las conocemos poque las hemos realizado de forma manual en el escenario anterior, pero ahora este agente agrega una tercer función la cual injecta código al yaml de despliegue basado en una plantilla **Consul**. Las tres funciones básicas que realiza son las siguientes:
   * Se autentica con Vault mediante el método de autenticación de Kubernetes. 
   * Almacena el token Vault en un archivo receptor como /var/run/secrets/vaultproject.io/token, y lo mantiene válido actualizándolo en el momento apropiado.
   * La última característica de Vault Agent es la plantilla, permite que los secretos de Vault se bajen a los archivos mediante **Consul Tamplate Markup**.

Diagrama:
![Agent](https://raw.githubusercontent.com/ferluko/ocp-vault-poc/master/images/vault_agent_improved_arch.png)

Primero el *Mutating Webhook* estará continuamente escaneado aquellos despliegues con el `annotation` `vault.hashicorp.com/agent-inject: 'true'`. Cuando esto suceda, injectará al código del YAML del despliegue de forma automatica el **Sidecar Container**  con las funciones que hemos mencionado anteriormente. Adicionalmente el comportamiento y la parametría de este Agente se realiza con `annotations`(https://www.vaultproject.io/docs/platform/k8s/injector/annotations) adiconales. Se sugiere complementar el entendimiento con la _Documentación Adicional_

Ejemplos de los `annotations` de escenario en curso son:
```
annotations:
        vault.hashicorp.com/agent-inject: 'true'
        vault.hashicorp.com/agent-init-first: "true"
        vault.hashicorp.com/agent-inject-status: "update"
        vault.hashicorp.com/agent-inject-secret-application.properties: "database/creds/vault-app-mongodb-role"
        vault.hashicorp.com/agent-inject-template-application.properties: |
          {{- with secret "database/creds/vault-app-mongodb-role" -}}
          const config = {db: { SECRET: '{{.Data.username }}:{{.Data.password }}' }};module.exports = config;   
          {{- end }}
        vault.hashicorp.com/secret-volume-path-application.properties: "/deployments/config"
        vault.hashicorp.com/agent-pre-populate-only: "true"
        vault.hashicorp.com/role: vault-app-mongodb-role
        vault.hashicorp.com/tls-skip-verify : "true"
```

#### Instalación de Vault Injector
Como primer paso, entonces realizaremos el despliegue del [Agente de Vault Injector](https://www.vaultproject.io/docs/platform/k8s/injector) en el mismo namespace del Vault Server: `hashicorp`. 
Durante este despliegue se estarán creando los siguientes objetos K8s en nuestro cluster OCP:
* vault-injector ClusterRole
* vault-injector ClusterRoleBinding
* vault-injector ServiceAccount
* vault-injector Deployment
* vault-injector Service
* vault-injector NetworkPolicy
* vault-injector MutatingWebhookConfiguration

_En tu maquina local_
Nos posicionamos sobre el reposito que hemos clonado y sobre el proyecto `hashicorp`. 
```
oc project hashicorp
oc apply -f vault/injector/install/
```
Agregamos el Mutation Webhook como un label del proyecto para que esta funcionalidad automática entre en juego:
```
oc label namespace vault-app vault.hashicorp.com/agent-webhook=enabled
```
Desplegamos la misma aplicación con los `annotations` mencionados anteriormente:
```
oc create -f example02/020-deployConfig-Vault-app-api-Inject.yaml
```
Verificar los logs de deployment, de ejecución del init Container y la aplicación a modo didáctico.
```
watch oc status --suggest
oc logs -f vault-app-api
```


#### REFERENCIAS: 
* https://www.vaultproject.io/docs/platform/k8s/injector
* https://www.hashicorp.com/blog/injecting-vault-secrets-into-kubernetes-pods-via-a-sidecar/
* https://www.openshift.com/blog/integrating-hashicorp-vault-in-openshift-4

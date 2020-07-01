# ocp-vault-poc Stage #1 - OCP + Vault
Prueba de Concepto para la integración de Hashicorp Vault en Openshift para Aplicaciones "No native Vault logic built-in".
 
## Introducción
Estas instrucciones permitirán obtener una copia la PoC en funcionamiento en tu máquina local para propósitos de depliegue y pruebas.

## Conceptos a ver...
* Conceptos a generales de Vault
* Instalación: Seal/Unseal
* Policy/ Role/ Path Secret/ Token
* Auth Methods: Token, K8s
* Engines: KV, Database
* MongoDB Plugin
* Vault Agent Injector
* Dynamics Secrets: lease/ revoke

### Pre-Requisitos
_En tu maquina local._
* [Openshift CLI](https://docs.openshift.com/container-platform/4.2/cli_reference/openshift_cli/getting-started-cli.html) - Instalado y login configurado contra el cluster OCP.
* [Vault CLI 1.4](https://www.vaultproject.io/docs/install#precompiled-binaries) - Cliente CLI Vault 

_NOTA: Este despliegue podrá sencillamente adaptarse a otras versiones de Kubernetes (GKE, AKS, PKS, etc)_

## Comenzando
_En tu maquina local._

Clonamos el repositorio y creamos el proyecto ```vault-app``` en Openshift

```
git clone https://github.com/ferluko/ocp-vault-poc.git
cd ocp-vault-poc
oc new-project vault-app
```
### Despliegue MongoDB
Para la persistencia de los datos de la aplicación ```vault-app-api```  se utiliza un backend de base de datos MondoDB donde se incluye la creación de secrectos de K8s para la inicialización del motor de base de datos MongoDB Ephemeral. La inicialización de la imagen de MongoDB utiliza las variables de entorno especificadas en el archivo de despliegue.

**[010-deploy-secret-mongodb-service.yaml](https://github.com/ferluko/ocp-vault-poc/blob/master/mongodb/010-deploy-secret-mongodb-service.yaml)**
```
oc create -f mongodb/010-deploy-secret-mongodb-service.yaml 
```

## ESCENARIO 0 - ESCENARIO ORIGINAL

**Descripción:** Construcción y despliegue de la aplicación `vault-app-api`. Esta aplicación en *Node.js* trata de una API HTTP sencilla para el registro a citas y persistirlas en una base de datos *MondoDB*. A modo didáctico y para no utilizar terceras herramientas, se utiliza el módulo *Swagger* para operaciones de GET y POST. Las credenciales a la base de datos *MongoDB* son obtenidas al despliegue (secretos nativos de Kubernetes) e inyectadas al código de la aplicación de forma tradicional, es decir vía de variables de entorno.

**Objetivo Particular:**  Mostrar el escenario original: el código de la aplicación, su sencilla arquitectura, como son manejados y consumidos los secretos, el despliegue. 

### Construcción (Building) de la aplicación demo
Para el **build** de la aplicación utilizamos el código que se encuenta en la carpeta **appointment** del repositorio (branch **master**) y la llamamos ```vault-app-api```

```
oc new-build https://github.com/ferluko/ocp-vault-poc.git --context-dir appointment --name vault-app-api
```
Observar el progreso con 
```
watch oc status --suggest
oc logs -f vault-app-api-1-build
```

### Despliegue (Deploy) de la aplicación "demo"
A continuación desplegamos la aplicación ```vault-app-api``` con la imagen del último **build** realizado. Las credenciales, el nombre de la base, IP y puerto que serán parte del string de conexión a MongoDB son provistos por **variables de entorno** utilizando los **Secretos de K8s** , los mismos que previamente fueron utilizados para inialización de la misma base de datos. De esta forma representamos un escenario original donde los secretos de una aplicacion (string de conexión) son variables de entorno, es decir secretos de K8s.

**[020-deployConfig-api.yaml](https://github.com/ferluko/ocp-vault-poc/blob/master/example00/020-deployConfig-api.yaml)**
``` 
oc create -f example00/020-deployConfig-api.yaml
oc expose svc vault-app-api
oc status --suggest
```
_NOTA: A modo ejemplo de esta PoC, observando en los logs del POD ```vault-app-api``` aparece el string de conexión a la base de datos ni bien se inicializa la aplicación. en un entorno real y productivo no se aconseja ya que va en contra de las buenas prácticas de seguridad, en otras palabra nuestro secreto deja de ser secreto._
```oc logs -f vault-app-api```

Endpoint URL para probar la APP, simplemente pegue la salida el siguiente comando en su Browser:
```
echo "http://`oc get route | grep -m1 vault-app-api | awk '{print $2}'`/api-docs/"
```
o simplemente pruebe esta API Rest desde su forma nativa:
```
curl -X GET "http://`oc get route | grep -m1 vault-app-api | awk '{print $2}'`/appointment" -H "accept: application/json"
curl -X POST "http://`oc get route | grep -m1 vault-app-api | awk '{print $2}'`/appointment" -H "accept: application/json" -d ""
curl -X POST "http://`oc get route | grep -m1 vault-app-api | awk '{print $2}'`/appointment" -H "accept: application/json" -d ""
curl -X POST "http://`oc get route | grep -m1 vault-app-api | awk '{print $2}'`/appointment" -H "accept: application/json" -d ""
curl -X GET "http://`oc get route | grep -m1 vault-app-api | awk '{print $2}'`/appointment" -H "accept: application/json"
```
>
>Se recomienda utilizar Swagger desde el Browser ya que podemos simular el uso de esta API invocando a los metedos y asi comprobamos la conexión a la base de datos.
>

## INSTALACIÓN DE HASHICORP VAULT SERVER EN OPENSHIFT
_En tu maquina local._

```
oc new-project hashicorp
```
_**NOTA INTERNA:** Para el almacenamiento de todos los secretos, el siguiente despliegue de Vault utiliza un Physical Volumen (PV) llamado **vault-storage**, en el nodo bastion de nuestro lab se encuentra el siguiente script para crear el NFS export y mapearlo al PV que luego utilizará Vault para su instalación._
```
sudo ./nfs.sh 
>/exports/vault-storage
exit
```

Creamos el **Kubernetes System Account:** ```vault-auth``` y lo asignamos a todos los proyectos, este SA será ultilizado posteriormente para la autentificación de los PODs con **Vault** utilizando [**Kubernetes Auth Method**](https://www.vaultproject.io/docs/auth/kubernetes). Recomendamos reforzar su conocimiento leyendo como funciona este método en la _Documentación adicional_.
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
Por defecto Vault viene en [**Sealed state**](https://www.vaultproject.io/docs/concepts/seal) o precintado. A continuación estaremos inicializado Vault, generando por primera vez el **_Root Token_** y las llaves ([Algoritmo de Shamir](https://en.wikipedia.org/wiki/Shamir%27s_Secret_Sharing)) para el **unseal**.

_En tu maquina local._
```
POD=$(oc get pods -l app.kubernetes.io/name=vault --no-headers -o custom-columns=NAME:.metadata.name)
oc rsh $POD
```
Remote Shell al Pod de Vault, osea dentro del pod del Vault Server ejecutamos:
```
vault operator init --tls-skip-verify -key-shares=1 -key-threshold=1
```
Tomar nota de forma segura de `Unseal Key 1`  y el `Initial Root Token`:
```
Unseal Key 1: IK9R9Mn4Rj9ZoW3Cpx+9blxwMZGefQRF2jjgEWDijoQ=
Initial Root Token: s.lwJF5vQ1pyvCTxjKr1QkYS4L
```
Y exportarlas como variables de entornos para futuro uso:
```
export KEYS=IK9R9Mn4Rj9ZoW3Cpx+9blxwMZGefQRF2jjgEWDijoQ=
export ROOT_TOKEN=s.lwJF5vQ1pyvCTxjKr1QkYS4L
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
Cluster Name    vault-cluster-4dabc5a9
Cluster ID      28c1e080-1fd0-170e-2d55-5d49c93c0ea1
HA Enabled      false
```
`exit` para salir del **shell** del **POD**.

### Configuración de Vault
_En tu maquina local._

Ahora si listamos los Pods podrán verificar que el Vault server ya parece como `Ready` dado que pasó con éxito la prueba de `Readiness`
```
oc get pods
```

`$VAULT_TOKEN` es el token que hemos tomado nota en el paso previo (Instalación de Vault) y lo utilizaremos para conectarnos a Vault desde nuestro cliente local y realizar las siguientes configuraciones.

_NOTA:  Vault CLI utiliza las variables de entorno `VAULT_TOKEN` y `VAULT_ADDR` para autenticar sin certificados adicionales, por lo tanto siempre utilizaremos el parámetro `-tls-skip-verify` (Esto es configurable)._
```
export VAULT_TOKEN=s.lwJF5vQ1pyvCTxjKr1QkYS4L
export VAULT_ADDR=https://`oc get route | grep -m1 vault | awk '{print $2}'`
vault login -tls-skip-verify
```

A continuación estaremos configurando el metodo de autenticación Kubernetes, este mismo se utilizá en los escenarios 1 y 2 para la obtención de secretos.
Utilizaremos el **SA**(System Account) ```vault-auth``` previamente creado, obtendremos su **token** de K8s y lo registraremos en **Vault** junto a su certificado asociado. De esta forma cada **POD** que se ejecute en K8s podrá autenticarse con Vault. Luego dependerá del **Role** y de la **Policy** asociada que se especifique junto al **token** mencionado para la obtención de los secretos. Complementar el entendimiento con la _Documentación Adicional_.

Diagrama:

<img src="https://raw.githubusercontent.com/ferluko/ocp-vault-poc/master/images/k8s_auth.png"  width="640">

```
oc project hashicorp

secret=`oc describe sa vault-auth | grep 'Tokens:' | awk '{print $2}'`
token=`oc describe secret $secret | grep 'token:' | awk '{print $2}'`
pod=`oc get pods | grep vault | awk '{print $1; exit}'`
oc exec $pod -- cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt > ca.crt

vault auth enable -tls-skip-verify kubernetes
vault write -tls-skip-verify auth/kubernetes/config token_reviewer_jwt=$token kubernetes_host=https://kubernetes.default.svc:443 kubernetes_ca_cert=@ca.crt

vault read -tls-skip-verify auth/kubernetes/config
rm ca.crt
```

Limpiamos el despliegue de la app **vault-app-api** en el proyecto `vault-app` para dar comienzo al siguiente escenario.
```
oc project vault-app
oc delete all -l app=vault-app-api
oc get all
```

## ESCENARIO 1: VAULT API CALL - INIT CONTAINER

**Descripción:** Despliegue de la aplicación `vault-app-api` junto a un **_Init Container_** en el mismo POD que tendrá la función de obtener los secretos vía una llamada API HTTP a Vault y bajarlos en un volumen compartido entre estos dos contenedores del mismo POD.

**Objetivo Particular:** Introducción al manejo de secretos centralizados, metodo de autentificacion de Kubernetes, Vault API calls, estrategias para agregar manejo de secretos en aplicaciones legacy o “Not Vault Aware Apps”, es decir aplicaciones sin manejo de secretos en memoria de la App.

### Configuración de Vault para el escenario 1
> _A realizar por Seguridad Informatica_

**_Datos de Vault:_**
* **Policy:** policy-example
* **Role:** demo
* **Path secretos:** secret/mongodb
* **Tipo:** KV v1
* **SA:** default
* **Tipo de Auth:** K8s

A continuación estamos habilitando el **Engine Key/Value (KV)** en el path `secret/` y le asignamos una política `policy-example` con capacidades de _Read_ y _List_ en  `secret/mongodb`.
```
vault secrets enable -tls-skip-verify -version=1 -path=secret kv
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
Con el comando  `vault read`  observamos lo que acabamos de configurar:
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

Para la realización de la PoC vamos a leer (copiar) los secretos preexistente de k8s y llevarlos a Vault, pero en un **entorno real** el departamento _Seguridad Informatica_ deberia crear los secretos en el **path**: `secret/mongodb` donde se encuentra el **engine KV** previamente configurado y solo debería comunicar a _Infraestructura_ el **path** y el **role** del secreto.
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

### Despliegue de aplicación agregando Init Container.
> _A realizar por Infraestructura (DevOps)_

Para el corriente escenario, al despliegue le estaremos adicionando un **Init Container** al POD de la aplicación para la obtención de los secretos (credenciales de conexión a mongoDB), bajar los secretos a un archivo (`/deployments/config/application.properties`) en un volumen compartido entre ambos containers (init y main container) que será accesible por el **Main Container**, es decir por la aplicación **demo** para conectarse a MongoDB.

_**NOTAS:**
  * Este escenario es exclusivamente didáctico para demostrar el funcionamiento de Vault y su objetivo particular es demosotrar que solo modificando el despliegue de una aplicación, esta misma que previamente recibía los secretos por variables de entorno, ahora los recibe facilmente desde Vault agregando un `init container`.

  * Adicionalmente para esta PoC, el código de la aplicación fué escasamente adaptado para leer los secretos desde `/deployments/config/application.properties`, de no existir este archivo los secretos serán obtenidos desde las variables de entorno como fué demostrado en el escenario 0.

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

_**NOTA:** Observar que **no** se realiza un nuevo **build** de la aplicación, solo se modfica el despliegue de la misma agregando el **Init Container**._

**[020-deployConfig-api.yaml](https://github.com/ferluko/ocp-vault-poc/blob/master/example01/020-deployConfig-api.yaml)**
```
sed -i -e 's|VAULT_ADDR|'$VAULT_ADDR'|g' ./example01/020-deployConfig-api.yaml 
oc apply -f example01/020-deployConfig-api.yaml
oc expose svc vault-app-api
```
Verificar los logs de deployment y de ejecución del init Container y main container a modo didáctico. En un entorno productivo deberían quitarse los `cat` del script del `init container` del yaml anterior.
```
pod=`oc get pods -L app=vault-app-api --field-selector status.phase=Running --no-headers -o custom-columns=NAME:.metadata.name | grep vault`
oc logs -f $pod
oc logs $pod -c vault-init
```
Limpiamos el despliegue de la aplicación `vault-app-api` para dar comienzo al siguiente escenario.
```
oc delete dc vault-app-api
oc delete all -l app=vault-app-api
oc get all
```

## ESCENARIO 2:  VAULT AGENT INJECTOR - SIDECAR CONTAINER
**Descripción:** Despliegue de la aplicación `vault-app-api` modificando el yaml del escenario original solo agregando “annotations” para la inyección automática de secretos.

**Objetivo Particular:** Introducción a los secretos dinámicos, Vault injector: un sidecar container encargado de modificar dinámicamente el despliegue de la App, obtener los secretos, bajarlos en un volumen compartido, crear y revocar las credenciales de forma dinámica en MongoDB.

### [Vault Agent Injector](https://www.vaultproject.io/docs/platform/k8s/injector) ###
Vault Agent realiza tres funciones básicas, las dos primeras ya las conocemos porque las hemos realizado de forma manual en el escenario anterior, pero ahora este agente agrega una excelente tercer función por medio de la automatización: injectar código al yaml de despliegue basado en una plantilla **Consul** sumando Vault como agente a nuestras aplicaciones. Las tres funciones mencionadas de este Agente son:
   * Autenticar con Vault mediante el método de autenticación de Kubernetes. 
   * Almacenar el token Vault en un archivo receptor como /var/run/secrets/vaultproject.io/token, y lo mantiene válido actualizándolo en el momento apropiado.
   * La última característica de Vault Agent es la plantilla, permite que los secretos de Vault se bajen a los archivos mediante **Consul Tamplate Markup**.

Diagrama:
![Agent](https://raw.githubusercontent.com/ferluko/ocp-vault-poc/master/images/vault_agent_improved_arch.png)

Primero el *Mutating Webhook* estará continuamente escaneado aquellos despliegues con el *annotation* `vault.hashicorp.com/agent-inject: 'true'`. Cuando esto suceda, injectará código al YAML del despliegue con el **Sidecar Container** de forma automática con las funciones mencionadas anteriormente. El comportamiento y la parametría de este Agente también se realiza con más *annotations*(https://www.vaultproject.io/docs/platform/k8s/injector/annotations). Se sugiere complementar el entendimiento con la _Documentación Adicional_

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
> _A realizar por Infraestructura (DevOps)_

Como primer paso, realizaremos el despliegue del [Agente de Vault Injector](https://www.vaultproject.io/docs/platform/k8s/injector) en el mismo namespace del Vault Server: `hashicorp`. 
Durante este despliegue se estarán creando los siguientes objetos K8s en nuestro cluster OCP:
* vault-injector ClusterRole
* vault-injector ClusterRoleBinding
* vault-injector ServiceAccount
* vault-injector Deployment
* vault-injector Service
* vault-injector NetworkPolicy
* vault-injector MutatingWebhookConfiguration

_En tu maquina local._

Nos posicionamos sobre el repositorio que hemos clonado, sobre el namespace `hashicorp` y desplegamos el agente: 
```
oc project hashicorp
oc apply -f vault/injector/install/
```
#### Configuración de Vault para el escenario 2
> _A realizar por Seguridad Informática_

**_Datos de Vault:_**
* **Policy:** vault-app-policy-dynamic
* **Role:** vault-app-mongodb-role
* **Path secretos:** database/creds/vault-app-mongodb-role
* **Tipo:** Database (Mongodb plugin)
* **SA:** default
* **Tipo de Auth:** K8s

A continuación habilitamos el *Engine Database* para la utilización de los secretos dinámicos.
```
oc project vault-app
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

A continuacón estamos creando la política lllamda `vault-app-policy-dynamic` con capacidades de lectura para el **path** `database/creds/vault-app-mongodb-role`, crear y revocar *leases*.
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

Ya creado y configurado el **engine database** con el plugin de **MongoDB**, a continuación se configura el **role** `vault-app-mongodb-role` para autenticar vía metodo Kubernetes (con la SA `default` y desde cualquier namespace) con el alcance definido en la **policy**  `vault-app-policy-dynamic` con un TTL de 24hs:
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

En el proyecto `vault-app` agregamos el **label** para activar la injección de secretos de forma automatica, es decir activamos Mutation Webhook en el proyecto:
```
oc project vault-app
oc label namespace vault-app vault.hashicorp.com/agent-webhook=enabled
```
Desplegamos la misma aplicación pero en este caso solo agregando al YAML del escenario original los `annotations` mencionados anteriormente:
**[020-deployConfig-Vault-app-api-Inject.yaml](https://github.com/ferluko/ocp-vault-poc/blob/master/example02/020-deployConfig-Vault-app-api-Inject.yaml)**
```
oc create -f example02/020-deployConfig-Vault-app-api-Inject.yaml
oc expose svc vault-app-api
```
Verificar los logs de deployment, de ejecución del init Container y la aplicación a modo didáctico.
```
watch oc status --suggest
oc logs -f vault-app-api
```
>
>¿Pero quién y cómo se crean, actualizan y revocan los secretos dinámicos de la base de datos MongoDB?
>
La respuesta es sencilla, el propio Vault Server por cada vez que realizamos una llamada al `path` del secreto y este está configurado como dinámico. Con el siguiente comando verificamos que por cada `vault read` (en vault) se crea un secreto diferente en la base. De esta forma queda verificado que por cada instancia de la aplicación, es decir, por cada POD existen diferentes credenciales de acceso a MongoDB. 
```
vault read -tls-skip-verify -format json database/creds/vault-app-mongodb-role
{
  "request_id": "857a4353-d07f-eb19-0060-8d65614f43e2",
  "lease_id": "database/creds/vault-app-mongodb-role/GvmCJQIcbpVKp4mC1UY8h9y0",
  "lease_duration": 3600,
  "renewable": true,
  "data": {
    "password": "A1a-ti4kJph63jpbcaqQ",
    "username": "v-root-vault-app-mongo-NVPv6fQMPTkJAB15FcSp-1588254042"
  },
  "warnings": null
}
```

#### REFERENCIAS: 
* https://www.vaultproject.io/docs/platform/k8s/injector
* https://www.hashicorp.com/blog/injecting-vault-secrets-into-kubernetes-pods-via-a-sidecar/
* https://www.openshift.com/blog/integrating-hashicorp-vault-in-openshift-4
* https://github.com/hashicorp/vault-k8s

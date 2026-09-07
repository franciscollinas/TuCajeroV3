# TuCajeroV3

Punto de Venta de escritorio (Electron + React + tRPC + SQLite).

## Requisitos

- Node.js ≥ 20 y npm
- `better-sqlite3` se compila para el ABI de Electron (`npm install`); los tests de
  servicio que tocan la base de datos requieren correr bajo ese ABI (ver *Tests*).

## Desarrollo

```bash
npm install
npm run dev        # renderer (Vite) + proceso principal (Electron)
```

La app valida licencias con firma **Ed25519** usando una clave pública embebida
en el binario (`app/main/services/license-keys.ts`), por lo que no requiere
ninguna variable de entorno para el sistema de licencias. Sin la clave pública
la app no valida ninguna licencia (fail closed). El **KeyGen** firma con la clave
privada correspondiente (`KeyGen/.env` → `LICENSE_PRIVATE_KEY`, nunca se distribuye):

```bash
# KeyGen/.env
LICENSE_PRIVATE_KEY=<base64 PKCS8 de la clave privada Ed25519>
```

## Licencias

1. El cliente instala la app y copia su **fingerprint** (pestaña *Licencia* → *Copiar fingerprint*).
2. Genera la licencia con el KeyGen (`npm run keygen`) usando los meses deseados.
3. El cliente la pega en *Licencia* → *Activar*.

Ver `KeyGen/README.md` para los pasos del KeyGen.

## Empaquetar

```bash
npm run dist      # instalador + portable
```

En el binario empaquetado la validación usa la clave pública embebida: el cliente
instala y activa sin configuración adicional (no hace falta inyectar secretos al
arrancar).

## Tests

```bash
npm test
```

`better-sqlite3` está compilado para el ABI de Electron, así que con el Node del
sistema los tests de servicio se saltan. Para ejecutarlos completos (el ABI de
Electron coincide):

```powershell
$env:ELECTRON_RUN_AS_NODE="1"
npx vitest run
```

## Verificación

```bash
npm run typecheck        # proyecto completo
npm run typecheck:main   # solo proceso principal
npm run lint
```

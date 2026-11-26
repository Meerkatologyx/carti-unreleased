// Runs before any other app module is evaluated (first import in main.tsx):
// module-level code elsewhere (the store's initial route) already reads the
// path, and the first API requests must hit the Carti data shim.
import { installBasePath } from './basePath'
import { installCartiApi } from './cartiApi'

installBasePath()
installCartiApi()

import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./VampView.desktop'), () => import('./VampView.mobile'))

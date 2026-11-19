import './styles.css';
import { mountShell } from './lobby/shell';
import { PlaneHoopsApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The #app root element is missing.');
mountShell(root);
const game = new PlaneHoopsApp(root);
game.start();

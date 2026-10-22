import { SITES } from './lib/sites.js'

if (SITES) import('./sites-bootstrap.jsx')
else import('./mount-app.jsx').then(({ mountApp }) => mountApp())

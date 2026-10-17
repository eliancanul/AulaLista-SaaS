import React from 'react';
import {createRoot} from 'react-dom/client';
import {AcentaApp} from './acenta/App';
import './acenta/style.css';
// B1 has no configured identity provider yet. No URL, build flag or browser header grants a session.
createRoot(document.getElementById('root')!).render(<AcentaApp controller={null}/>);

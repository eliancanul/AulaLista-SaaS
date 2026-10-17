import React from 'react';
import {createRoot} from 'react-dom/client';
import {AuthenticatedApp} from './acenta/AuthenticatedApp';
import {AuthController} from './acenta/auth';
import './acenta/style.css';
// Session authority comes exclusively from the server's HttpOnly cookie.
createRoot(document.getElementById('root')!).render(<AuthenticatedApp auth={new AuthController()}/>);

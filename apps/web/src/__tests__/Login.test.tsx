import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { Login } from '../pages/Login';
import { mockFetch, renderWithProviders } from './helpers';

beforeEach(() => sessionStorage.clear());

const routes = (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<div>dispatcher home</div>} />
    <Route path="/driver" element={<div>driver home</div>} />
  </Routes>
);

test('signs in a dispatcher and opens the dashboard', async () => {
  const calls = mockFetch(() => ({ body: { token: 't', user: { id: '1', name: 'Jonas Weber', email: 'dispo@tourwerk.de', role: 'DISPATCHER', vehicle: null } } }));
  renderWithProviders(routes, '/login');
  await userEvent.type(screen.getByLabelText('Email'), 'dispo@tourwerk.de');
  await userEvent.type(screen.getByLabelText('Password'), 'Tourwerk2026!');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('dispatcher home')).toBeInTheDocument();
  expect(calls[0].url).toBe('/api/auth/login');
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'dispo@tourwerk.de', password: 'Tourwerk2026!' });
  expect(JSON.parse(sessionStorage.getItem('tourwerk.session')!).token).toBe('t');
});

test('drivers land on their mobile tour view', async () => {
  mockFetch(() => ({ body: { token: 't', user: { id: '2', name: 'Kemal', email: 'fahrer1@tourwerk.de', role: 'DRIVER', vehicle: { id: 'v', plate: 'HH-TW 101' } } } }));
  renderWithProviders(routes, '/login');
  await userEvent.click(screen.getByRole('button', { name: /fahrer1@tourwerk.de/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('driver home')).toBeInTheDocument();
});

test('shows the server error for wrong credentials', async () => {
  mockFetch(() => ({ status: 401, body: { error: 'Email or password is incorrect' } }));
  renderWithProviders(routes, '/login');
  await userEvent.type(screen.getByLabelText('Email'), 'dispo@tourwerk.de');
  await userEvent.type(screen.getByLabelText('Password'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

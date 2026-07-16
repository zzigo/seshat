/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    session: unknown;
    account: import('./lib/user-accounts').UserAccount | null;
  }
}

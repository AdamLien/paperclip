# OCX native settings entry

Instance administrators can open the existing OCX UI from mDeck management. The configured URL is an HTTPS origin or HTTP loopback origin, with an optional exact #providers fragment. No browser-selected destination or credential is accepted. The redirect checks the current authenticated board instance-admin role and sends no-store. Native OCX still requires its own authentication. Workspace managers and employees cannot use this instance entry.

Deployment is limited to independent UAT. Current maintenance mode uses a local SSH forward and clearly labels that dependency. This is not a cross-device SSO proxy. Provider authorization and actual model generation remain separate acceptance gates.

Verification: route/service tests cover URL rejection, absent configuration, anonymous/nonadmin denial, fixed redirect and conditional status links. No database changes.

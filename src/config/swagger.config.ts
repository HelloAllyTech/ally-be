// Memory storage for Swagger tokens (most secure approach)
// Make token accessible globally for Swagger UI
declare global {
  interface Window {
    swaggerToken: string | null;
  }
}

export const swaggerCustomOptions = {
  swaggerOptions: {
    persistAuthorization: false, // Disable localStorage persistence
    requestInterceptor: (req: any) => {
      if ((window as any).swaggerToken) {
        req.headers.Authorization = `Bearer ${(window as any).swaggerToken}`;
      }
      return req;
    },
    responseInterceptor: (res: any) => {
      // Store token from login response
      if (res.url?.includes('/api/v1/auth/login') && res.body) {
        try {
          const body = JSON.parse(res.text);
          if (body.accessToken) {
            (window as any).swaggerToken = body.accessToken;
            const ui = (window as any).ui;
            ui?.preauthorizeApiKey('access-token', body.accessToken);
          }
        } catch (e) {
          // Silently fail
        }
      }

      // Clear token on logout
      if (res.url?.includes('/api/v1/auth/logout')) {
        (window as any).swaggerToken = null;
      }

      return res;
    },
    onComplete: () => {
      // Apply stored token on page load
      if ((window as any).swaggerToken) {
        const ui = (window as any).ui;
        ui?.preauthorizeApiKey('access-token', (window as any).swaggerToken);
      }
    },
  },
};

export const swaggerCustomOptions = {
  swaggerOptions: {
    requestInterceptor: (req: any) => {
      // Auto-capture and apply token from login response
      return req;
    },
    responseInterceptor: (res: any) => {
      // Check if this is a login response and has an access token
      if (res.url && res.url.includes('/api/v1/auth/login') && res.body) {
        try {
          const body = JSON.parse(res.text);
          if (body.accessToken) {
            // Store token in localStorage for persistence
            localStorage.setItem('swagger_auth_token', body.accessToken);
            // Auto-authorize with the received token (Swagger adds "Bearer " automatically)
            const ui = (window as any).ui;
            if (ui) {
              ui.preauthorizeApiKey('access-token', body.accessToken);
            }
          }
        } catch (e) {
          // Silently fail if parsing doesn't work
        }
      }
      return res;
    },
    onComplete: () => {
      // On page load, check if we have a stored token and apply it
      try {
        const storedToken = localStorage.getItem('swagger_auth_token');
        if (storedToken) {
          const ui = (window as any).ui;
          if (ui) {
            // Swagger adds "Bearer " automatically
            ui.preauthorizeApiKey('access-token', storedToken);
          }
        }
      } catch (e) {
        // Silently fail if localStorage is not available
      }
    },
  },
};

const express = require('express');
const app = express();
const port = process.env.PORT || 8080;
const RAILWAY_API_TOKEN = '8861c344-0a15-40a1-a47c-6845dc591cea';

app.use(express.json());

let clients = [];
let lastStatus = {};

// Initial fetch from Railway
async function fetchStatus() {
    const query = `
    query {
      projects {
        edges {
          node {
            id
            name
            environments {
              edges {
                node {
                  id
                  name
                  deployments(first: 1) {
                    edges {
                      node {
                        id
                        status
                        createdAt
                        serviceId
                      }
                    }
                  }
                }
              }
            }
            services {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }`;

    try {
        const res = await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RAILWAY_API_TOKEN}`
            },
            body: JSON.stringify({ query })
        });
        const data = await res.json();
        
        const services = {};
        data.data.projects.edges.forEach(p => {
            const serviceMap = {};
            p.node.services.edges.forEach(s => {
                serviceMap[s.node.id] = s.node.name;
            });

            p.node.environments.edges.forEach(e => {
                e.node.deployments.edges.forEach(d => {
                    const sId = d.node.serviceId;
                    services[sId] = {
                        projectName: p.node.name,
                        serviceName: serviceMap[sId] || 'Unknown Service',
                        status: d.node.status,
                        at: d.node.createdAt,
                        projectUrl: `https://railway.app/project/${p.node.id}`
                    };
                });
            });
        });
        lastStatus = services;
    } catch (e) {
        console.error('Initial fetch failed', e);
    }
}

// SSE Setup
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client = { id: Date.now(), res };
    clients.push(client);
    
    // Send initial state
    res.write(`data: ${JSON.stringify({ type: 'init', data: lastStatus })}\n\n`);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== client.id);
    });
});

// Webhook from Railway
app.post('/webhook', (req, res) => {
    const { deployment, status, project, service } = req.body;
    if (deployment) {
        const update = {
            type: 'update',
            serviceId: service?.id || deployment.serviceId,
            serviceName: service?.name || 'Unknown',
            projectName: project?.name || 'Unknown',
            status: status || deployment.status,
            at: new Date().toISOString()
        };
        
        // Update local state
        lastStatus[update.serviceId] = {
            projectName: update.projectName,
            serviceName: update.serviceName,
            status: update.status,
            at: update.at
        };

        // Notify clients
        clients.forEach(c => c.res.write(`data: ${JSON.stringify(update)}\n\n`));
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Tracker running on port ${port}`);
    fetchStatus();
});


/** @type {import('next').NextConfig} */
const nextConfig = {
    // pino uses native Node.js workers — must not be bundled by webpack
    serverExternalPackages: ['pino'],
};
module.exports = nextConfig;

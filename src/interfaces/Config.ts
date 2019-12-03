export interface Config {
    plugins: string[];
    git: Git;
    sonarqube: Sonarqube;
}

export interface Git {
    client: string;
    host: string;
    token: string;
}

export interface Sonarqube {
    host: string;
    sslEnabled: boolean;
}
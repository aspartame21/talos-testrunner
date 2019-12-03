import { Plugin } from "./interfaces/Plugin";
import { GitClient } from "./interfaces/GitClient";
import { NoteEvent } from "./interfaces/events/NoteEvent";
import { Config } from "./interfaces/Config";
import { GitProvider } from "./GitProvider";
import { PipelineEvent } from "./interfaces/events/PipelineEvent";
import { RepositoryOwners } from "./interfaces/structs/RepositoryOwners";

export default class Approve implements Plugin<any, Promise<any>> {
    private client: GitClient;
    private config: Config;

    constructor(config: Config) {
        this.client = GitProvider.getInstance(config.git)
    }

    async handle(rx: any): Promise<any> {
        if (rx.object_kind === "note")
            return this.handlePipelineRequest(rx)

        if (rx.object_kind === "pipeline")
            return this.handlePipelineEvent(rx)

    }

    private async handlePipelineRequest(rx: NoteEvent) {

        if (!rx.object_attributes.note.includes("/test"))
            return

        const successMessage = `
            @${rx.user.username}, 
            your requst for tests has been submitted! 
            I will post test results once they are ready.
            `

        const failMessage = `
            Sorry @${rx.user.username} but you are not allowed to run tests
        `

        let message = successMessage

        const { approvers, reviewers } = <RepositoryOwners>await this.client
            .RepositoryOwners.show(rx.project_id)

        if (!approvers.map(u => u.id).includes(rx.object_attributes.author_id) ||
            !reviewers.map(u => u.id).includes(rx.object_attributes.author_id))
            message = failMessage

        if (message === successMessage)
            this.triggerPipeline(rx)

        return this.client.MergeRequestNotes.create(rx.project_id, rx.merge_request.iid, message)
    }

    private async triggerPipeline(rx: NoteEvent) {
        const variables = [
            { "key": "MR_ID", "value": rx.merge_request.iid.toString() },
            { "key": "MR_REF", "value": rx.merge_request.source_branch },
            { "key": "TEST_TYPE", "value": rx.object_attributes.note.replace('/test ', '') }
        ];

        return this.client.Pipelines
            .create(
                rx.project_id,
                rx.merge_request.target_branch,
                { variables }
            )
            .catch(err => console.log(err));
    }

    private handlePipelineEvent(rx: PipelineEvent) {
        const status = rx.object_attributes.detailed_status;
        if (status !== "passed")
            return

        const projectId = rx.project.id;
        const MR_ID = parseInt(rx.object_attributes.variables.find(v => v.key === "MR_ID").value);
        const TEST_TYPE = rx.object_attributes.variables.find(v => v.key === "TEST_TYPE").value;
        const jobID = rx.builds.find(b => b.name === "Code Quality").id;

        if (TEST_TYPE === 'sonar')
            return this.client.MergeRequestNotes.create(projectId, MR_ID, this.generateSonarReport(rx));

        if (TEST_TYPE === 'codeclimate')
            return this.generateCCReport(rx.project.web_url, jobID)

    }

    private generateSonarReport(rx: PipelineEvent) {
        return `You can review the code quality report by following this [link](${ this.config.sonarqube.sslEnabled ? 'https' : 'http' }//${this.config.sonarqube.host}/dashboard?id=${rx.project.name}&branch=${rx.object_attributes.ref})`
    }

    private generateCCReport(web_url: string, jobID: number) {
        const reportUrl = this.generateReportURL(web_url, jobID);
        return this.generateCCReportSummary(reportUrl)
    }

    private generateReportURL(projectURL: string, jobID: number | string) {
        return projectURL + '/-/jobs/' + jobID + "/artifacts/raw/gl-code-quality-report.html?inline=false";
    }

    private generateCCReportSummary(reportURL: string) {
        return [
            `The following table represents several test results, 
            say \`/test\` to start them over: `, "",
            "Test Name | Status | Details ",
            "---|:---:|---",
            `Code Quality | :white_check_mark: | [Link](${reportURL})`,
            "Unit Tests | :warning: | N/A",
            "Code Coverage | :no_entry: | Link"
        ].join("\n")
    }
}

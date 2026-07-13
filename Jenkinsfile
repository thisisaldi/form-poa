@Library('pharmalink-shared-library')_
pipeline {
	agent {
		node {
			label 'jenkins-agent-fe'
		}
	}

	environment {
		PROJECT_ID = "chc-main"

		NAME = "form-poa"
		ORG = "chc"

		K8S_CLUSTER = "red-phoenix"
		GCS_BUCKET_CHART = "gs://pharmalink-id-chartmuseum/${ORG}"

		ARTIFACT_REGISTRY = "asia-docker.pkg.dev"
		DOCKER_REGISTRY = "asia.gcr.io"
		DOCKER_REGISTRY_URL = "https://${ARTIFACT_REGISTRY}"
		DOCKER_REGISTRY_PROJECT_URL = "${ARTIFACT_REGISTRY}/${PROJECT_ID}/${DOCKER_REGISTRY}"
		DOCKER_BUILDKIT = 1

		DISCORD_WEBHOOK_URL = credentials('pharmalogic-discord-webhook-url')

		PIPELINE_NAME = "CHC - Form POA"
		PIPELINE_BOT_EMAIL = "pharos.bot@gmail.com"
		PIPELINE_BOT_NAME = "Pharmalink Pipeline Bot"
	}

	options {
		skipDefaultCheckout(true)
	}

	stages {
		stage('Checkout SCM') {
			steps {
				checkoutSCM()
			}
		}

		stage('Setup Discord Notification') {
			steps {
				setupDiscordNotification()
			}
		}

		stage('Versioning') {
			steps {
				version()
			}
		}

		stage('Build') {
			steps {
				echo '> Installing dependencies ...'
				sh 'npm install --frozen-lockfile'

				script {
					echo '> Building application ...'
					parallel (
						"staging": {
							sh 'npm build:staging'
						},
						"production": {
							sh 'npm build:production'
						}
					)
				}
			}
		}

		stage('Dockerize') {
			steps {
				script {
					echo '''
						> Configure docker auth for artifact registry push ...
					'''
					sh 'gcloud auth configure-docker asia-docker.pkg.dev'

					def gitBranchToDockerfileStage = [
						"master": "staging-production",
						"testdev": "development"
					]

					def dockerfileStage = null
					if (!gitBranchToDockerfileStage.containsKey(
						env.gitlabSourceBranch
					)) {
						dockerfileStage = gitBranchToDockerfileStage["master"]
					} else {
						dockerfileStage = gitBranchToDockerfileStage[
							env.gitlabSourceBranch
						]
					}

					echo '> Creating image ...'
					def dockerImage = docker.build(
						"${DOCKER_REGISTRY_PROJECT_URL}/${NAME}:${VERSION}",
						"--target ${dockerfileStage} ."
					)

					echo '> Pushing image ...'
					docker.withRegistry("${DOCKER_REGISTRY_URL}", "") {
						dockerImage.push()
					}
				}
			}
		}

		stage('Helm K8s') {
			steps {
				echo '> Changing repository name value ...'
				sh """
					sed -i \
						's#repository: draft#repository: ${DOCKER_REGISTRY_PROJECT_URL}/${NAME}#g' \
						k8s/values.yaml
				"""

				echo '> Changing version value ...'
				sh """
					sed -i \
						's/tag: dev/tag: ${env.VERSION}/g' \
						k8s/values.yaml
				"""

				echo '> Packing helm chart ...'
				sh "cd k8s && helm package . --version=${env.VERSION}"

				echo '> Uploading chart ...'
				sh """
					cd k8s && gsutil cp ${NAME}-${VERSION}.tgz ${GCS_BUCKET_CHART}
				"""

				echo '> Removing uploaded chart package ...'
				sh "rm k8s/${env.NAME}-${env.VERSION}.tgz"
			}
		}
	}

	post {
		always {
			cleanWs()
		}

		success {
			build(
				job: "${env.GKE_JOB_NAME}",
				parameters: [
					string(name: 'PROJECT_NAME', value: "${env.NAME}"),
					string(name: 'PROJECT_VERSION', value: "${env.VERSION}"),
					string(
						name: 'PROJECT_URL',
						value: "${env.gitlabSourceRepoHttpUrl}",
					)
				],
				wait: false
			)
			discordSend(
				link: env.BUILD_URL,
				result: currentBuild.currentResult,
				title: "${env.PIPELINE_NAME} #${env.BUILD_NUMBER}",
				webhookURL: env.DISCORD_WEBHOOK_URL,
				description: """
					${env.DISCORD_DESC}
					\n\n
					Pipeline succeeded
				""".trim(),
				footer: "Tags: v${env.VERSION}"
			)
			sh "exit 0"
		}

		regression {
			script {
				discordSend(
					link: env.BUILD_URL,
					result: currentBuild.currentResult,
					title: "${env.PIPELINE_NAME} #${env.BUILD_NUMBER}",
					webhookURL: env.DISCORD_WEBHOOK_URL,
					description: """
						${env.DISCORD_DESC}
						\n\n
						Pipeline failed or aborted, see console output for more details
					""".trim(),
					footer: "Tags: v${env.VERSION}"
				)
			}
			sh "exit 1"
		}
	}
}

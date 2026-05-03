plugins {
    id("com.android.library") version "8.2.0"
    id("org.jetbrains.kotlin.android") version "1.9.22"
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22"
    id("maven-publish")
    id("signing")
}

group = "com.postpaddy"
version = "0.1.0"

android {
    namespace = "com.postpaddy.supports"
    compileSdk = 34
    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }
    kotlinOptions { jvmTarget = "17" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

afterEvaluate {
    publishing {
        publications {
            create<MavenPublication>("release") {
                from(components["release"])
                groupId = "com.postpaddy"
                artifactId = "supports-android"
                version = project.version.toString()

                pom {
                    name.set("Postpaddy Supports Android")
                    description.set("Android SDK for Supports by Postpaddy")
                    url.set("https://github.com/postpaddy/postpaddy-supports-sdks")
                    licenses {
                        license {
                            name.set("MIT")
                            url.set("https://opensource.org/license/mit")
                        }
                    }
                    developers {
                        developer {
                            id.set("postpaddy")
                            name.set("Postpaddy")
                        }
                    }
                    scm {
                        connection.set("scm:git:git://github.com/postpaddy/postpaddy-supports-sdks.git")
                        developerConnection.set("scm:git:ssh://github.com:postpaddy/postpaddy-supports-sdks.git")
                        url.set("https://github.com/postpaddy/postpaddy-supports-sdks")
                    }
                }
            }
        }
    }
}

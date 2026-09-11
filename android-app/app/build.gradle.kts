import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dsh.web"
    compileSdk = 34

    signingConfigs {
        create("projectDebug") {
            storeFile = File(projectDir, "../keystore/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    defaultConfig {
        applicationId = "com.dsh.web"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.5-alpha"
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("projectDebug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("projectDebug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
}
